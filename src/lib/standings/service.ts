// DB-backed standings logic — Session 9's brief. Two halves, deliberately
// asymmetric in cost:
//
//   - `recomputeStandings` is the only place that ever calls the Session
//     2-4 scoring engine's `score()`. It's on-demand (an admin action via
//     POST /api/seasons/:id/recompute, or later a data-ingestion job —
//     docs/DECISIONS.md: "on-demand with snapshot write... not a fixed
//     daily cron"), reads across picks/questions/results, and writes one
//     `standings_snapshot` row.
//   - `getLatestSnapshot`/`getStandingsHistory` are what every read
//     endpoint calls. Each is exactly one indexed query against
//     `standings_snapshot` alone — doc 02 §3.4 / doc 03 §1.5's whole reason
//     this table exists. Neither ever touches picks, questions, or results.

import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import {
  member,
  standingsSnapshot,
  user,
  type StandingsBreakdownEntry,
  type StandingsEntry,
} from "../db/schema.js";
import { getAllPicks } from "../picks/service.js";
import { activeMemberIds, getQuestions, loadSeason } from "../seasons/service.js";
import { requireMembership, requireAdmin } from "../groups/service.js";
import { buildResultSetFromLiveState, buildResultSetFromResults } from "./results.js";
import { score } from "../scoring/index.js";
import type { Pick as ScoringPick, Question as ScoringQuestion, ScoringConfig } from "../scoring/types.js";
import { AppError } from "../errors.js";

// doc 03 §2.1's ScoringConfig carries a `boldnessWeight` the season row
// itself has no column for (src/lib/db/schema.ts's SeasonScoringConfig is
// just { boldPickEnabled, injuryRule }) — no caller has bridged the two
// before this session. Doc 03 §2.4's own stated default is 1.0, so that's
// what's used here; nothing in the schema or docs suggests it should ever
// be admin-configurable per season.
const DEFAULT_BOLDNESS_WEIGHT = 1;

export type StandingsSnapshotRow = typeof standingsSnapshot.$inferSelect;

// Every standings endpoint (read or recompute) must verify group
// membership first — same discipline as Sessions 6-8's requireSeasonMember/
// requireSeasonAdmin. Standings have no extra visibility rule of their own
// (unlike picks/all's lock-gated reveal): any current group member can see
// standings, projected or final, at any time.
export async function requireStandingsReader(db: Db, seasonId: string, userId: string, now: Date) {
  const seasonRow = await loadSeason(db, seasonId, now);
  await requireMembership(db, seasonRow.groupId, userId);
  return seasonRow;
}

export async function requireStandingsAdmin(db: Db, seasonId: string, userId: string, now: Date) {
  const seasonRow = await loadSeason(db, seasonId, now);
  await requireAdmin(db, seasonRow.groupId, userId);
  return seasonRow;
}

// GET /api/seasons/:id/standings — doc 03 §3.5. The single indexed query
// this whole table exists for (doc 02 §3.4): one row off
// standings_snapshot_season_id_computed_at_idx, nothing else.
export async function getLatestSnapshot(
  db: Db,
  seasonId: string
): Promise<StandingsSnapshotRow | undefined> {
  const [row] = await db
    .select()
    .from(standingsSnapshot)
    .where(eq(standingsSnapshot.seasonId, seasonId))
    .orderBy(desc(standingsSnapshot.computedAt))
    .limit(1);
  return row;
}

// GET /api/seasons/:id/standings/history — doc 03 §3.5: "position over time
// for the chart." Same single-table, same index, just without the LIMIT 1 —
// still one query, no join across picks/questions/results.
export async function getStandingsHistory(db: Db, seasonId: string): Promise<StandingsSnapshotRow[]> {
  return db
    .select()
    .from(standingsSnapshot)
    .where(eq(standingsSnapshot.seasonId, seasonId))
    .orderBy(desc(standingsSnapshot.computedAt));
}

function statusFrom(status: string): StandingsBreakdownEntry["status"] {
  // score()'s QuestionBreakdown['status'] is exactly this same literal
  // union (src/lib/scoring/types.ts's PickStatus) — this cast just crosses
  // the type boundary the two independent type definitions create (see
  // schema.ts's StandingsPickStatus doc comment for why they're not the
  // same imported type).
  return status as StandingsBreakdownEntry["status"];
}

// POST /api/seasons/:id/recompute — doc 03 §3.5 [admin, rate-limited]. The
// only function in this codebase that calls `score()` outside a test.
// Builds ScoringInput from the season's current picks and either `result`
// (settled) or `live_state` (still in progress), per doc 03 §2.5, then
// writes exactly one new standings_snapshot row.
export async function recomputeStandings(
  db: Db,
  seasonId: string,
  now: Date
): Promise<StandingsSnapshotRow> {
  const seasonRow = await loadSeason(db, seasonId, now);
  if (seasonRow.status === "draft") {
    throw new AppError(409, "Cannot compute standings before the season is published");
  }
  // doc 01 §4.3: a voided season "records no scores" — recomputing against
  // its live_state/result data would produce a snapshot that contradicts
  // that, so this is refused the same way a still-draft season is.
  if (seasonRow.status === "voided") {
    throw new AppError(409, "Cannot compute standings for a voided season");
  }

  const isSettled = seasonRow.status === "settled";
  const memberIds =
    seasonRow.memberSnapshot ?? (await activeMemberIds(db, seasonRow.groupId));
  if (memberIds.length === 0) {
    throw new AppError(409, "This season has no members to score yet");
  }

  const [questionRows, results] = await Promise.all([
    getQuestions(db, seasonId),
    isSettled
      ? buildResultSetFromResults(db, seasonRow.tournamentId, seasonId)
      : buildResultSetFromLiveState(db, seasonRow.tournamentId),
  ]);

  const memberRows = await db
    .select({ id: member.id, displayName: user.displayName })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(inArray(member.id, memberIds));
  const displayNameByMemberId = new Map(memberRows.map((row) => [row.id, row.displayName]));

  const questions: ScoringQuestion[] = questionRows.map((row) => ({
    id: row.id,
    type: row.type,
    config: row.config,
    points: row.points,
  }));

  const memberPicksRows = await getAllPicks(db, seasonId, memberIds);
  const picks: ScoringPick[] = memberPicksRows.flatMap((memberPicks) =>
    memberPicks.picks.map((row) => ({
      questionId: row.questionId,
      memberId: memberPicks.memberId,
      answer: row.answer,
    }))
  );

  const config: ScoringConfig = {
    boldPickEnabled: seasonRow.scoringConfig.boldPickEnabled,
    boldnessWeight: DEFAULT_BOLDNESS_WEIGHT,
  };

  const output = score({
    questions,
    picks,
    results,
    config,
    memberIds,
    isProjected: !isSettled,
  });

  const previous = await getLatestSnapshot(db, seasonId);
  const previousPointsByMember = new Map(
    (previous?.standings ?? []).map((entry) => [entry.memberId, entry.points])
  );

  const standings: StandingsEntry[] = output.standings.map((standing) => ({
    memberId: standing.memberId,
    displayName: displayNameByMemberId.get(standing.memberId) ?? "Unknown member",
    rank: standing.rank,
    points: standing.points,
    delta: standing.points - (previousPointsByMember.get(standing.memberId) ?? 0),
    breakdown: standing.breakdown.map((entry) => ({
      questionId: entry.questionId,
      points: entry.awarded,
      maxPossible: entry.maxPossible,
      status: statusFrom(entry.status),
      boldnessMultiplier: entry.boldnessMultiplier,
      explanation: entry.explanation,
    })),
  }));

  const [inserted] = await db
    .insert(standingsSnapshot)
    .values({
      seasonId,
      isProjected: !isSettled,
      standings,
      computedAt: now,
    })
    .returning();
  if (!inserted) {
    throw new AppError(500, "Failed to write standings snapshot");
  }
  return inserted;
}
