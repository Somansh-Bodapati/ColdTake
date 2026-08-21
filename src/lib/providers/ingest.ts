// The ingestion job itself — doc 03 §3.7: "runs the configured
// StandingsProvider, writes live_state, recomputes standings_snapshot for
// every active season on that tournament." Shared by both routes that
// trigger it (api/ingest/[tournamentId].ts, secret-guarded; and the manual
// admin-entry endpoint from session 10's task 3) so there's exactly one
// place that does "provider -> live_state -> fan-out recompute", regardless
// of which provider produced the data or who was allowed to trigger it.

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import { liveState, season, tournament, type LiveStateStatLeaders } from "../db/schema.js";
import { AppError } from "../errors.js";
import { recomputeStandings, type StandingsSnapshotRow } from "../standings/service.js";
import type { StandingsProvider, TeamStanding } from "./types.js";

export type LiveStateRow = typeof liveState.$inferSelect;

// A season only has a meaningful "current" projected standing to recompute
// while it's actually taking picks or waiting to settle (doc 03 §2.5's
// projected mode). 'draft' has no published questions/lock yet
// (recomputeStandings itself rejects it — src/lib/standings/service.ts);
// 'settled'/'voided' seasons are done and read from `result`, not
// `live_state`, so a fresh ingestion poll has nothing new to tell them.
const ACTIVE_SEASON_STATUSES = ["open", "locked"] as const;

export interface IngestResult {
  liveState: LiveStateRow;
  recomputedSnapshots: StandingsSnapshotRow[];
}

// This session's brief, task 3: "a data-provider failure must never surface
// as an error page to end users." A live provider (CricketDataProvider) can
// time out, return malformed JSON, or return a response missing fields it
// needs — any of those throws out of provider.getTable/getStatLeaders.
// Rather than letting that exception propagate (which would 500 the
// ingestion endpoint and, transitively, whatever triggered it), this catches
// it here — the one place shared by every provider — logs it, and returns
// the tournament's existing live_state row untouched. No new snapshot is
// computed in that case: nothing about the scored input changed, so there's
// nothing new to recompute. If no live_state row exists yet at all (first
// ingestion ever fails), there is no "last good" to fall back to; that's the
// one case this still surfaces as an error, to whatever internal caller
// triggered ingestion (never to an end user — the public standings read path
// never calls this function, it only ever reads the live_state table
// src/lib/standings/service.ts already wrote).
async function fetchProviderData(
  db: Db,
  provider: StandingsProvider,
  tournamentRow: typeof tournament.$inferSelect,
  tournamentId: string
): Promise<{ tableData: TeamStanding[]; statLeaders: LiveStateStatLeaders } | { fallback: LiveStateRow }> {
  const statCategories = tournamentRow.config.statCategories ?? [];
  try {
    const tableData = await provider.getTable(tournamentId);
    const statLeaders: LiveStateStatLeaders = {};
    for (const category of statCategories) {
      const entries = await provider.getStatLeaders(tournamentId, category);
      if (entries.length > 0) {
        statLeaders[category] = entries;
      }
    }
    return { tableData, statLeaders };
  } catch (error) {
    console.error(
      `ingestTournament: provider "${provider.source}" failed for tournament ${tournamentId}, keeping last good live_state`,
      error
    );
    const [existing] = await db.select().from(liveState).where(eq(liveState.tournamentId, tournamentId)).limit(1);
    if (!existing) {
      throw new AppError(
        502,
        `Standings provider "${provider.source}" failed and no previous live_state exists for tournament ${tournamentId}`
      );
    }
    return { fallback: existing };
  }
}

// Idempotency (this session's brief, task 6): live_state is a single row
// keyed by tournament_id (schema.ts: "One row per tournament"), upserted
// here rather than inserted, so running this twice with unchanged provider
// data never creates a second live_state row — the second call just
// overwrites the first with identical values. standings_snapshot does
// insert a fresh row each call by design (Session 9: every recompute is a
// new timestamped snapshot for the history chart), but its *scored values*
// come out identical on an unchanged input, since recomputeStandings is a
// pure function of live_state/picks/questions.
export async function ingestTournament(
  db: Db,
  provider: StandingsProvider,
  tournamentId: string,
  now: Date
): Promise<IngestResult> {
  const [tournamentRow] = await db.select().from(tournament).where(eq(tournament.id, tournamentId)).limit(1);
  if (!tournamentRow) {
    throw new AppError(404, "Tournament not found");
  }

  const providerData = await fetchProviderData(db, provider, tournamentRow, tournamentId);
  if ("fallback" in providerData) {
    // Provider failed and there's a previous good live_state: serve it
    // unchanged, skip the write and the recompute fan-out below — nothing
    // about the scored input actually changed.
    return { liveState: providerData.fallback, recomputedSnapshots: [] };
  }
  const { tableData, statLeaders } = providerData;

  const [liveStateRow] = await db
    .insert(liveState)
    .values({
      tournamentId,
      tableData,
      statLeaders,
      source: provider.source,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: liveState.tournamentId,
      set: { tableData, statLeaders, source: provider.source, fetchedAt: now },
    })
    .returning();
  if (!liveStateRow) {
    throw new AppError(500, "Failed to write live_state");
  }

  // Fan-out: this tournament can be tracked by several groups' seasons at
  // once (this session's brief, task 5) — every one of them needs its own
  // fresh standings_snapshot, not just the season the caller happened to
  // have in mind.
  const activeSeasons = await db
    .select({ id: season.id })
    .from(season)
    .where(and(eq(season.tournamentId, tournamentId), inArray(season.status, ACTIVE_SEASON_STATUSES)));

  const recomputedSnapshots: StandingsSnapshotRow[] = [];
  for (const activeSeason of activeSeasons) {
    recomputedSnapshots.push(await recomputeStandings(db, activeSeason.id, now));
  }

  return { liveState: liveStateRow, recomputedSnapshots };
}
