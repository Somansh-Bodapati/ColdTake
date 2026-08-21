// The ingestion pipeline itself (this session's brief, task 5 + 6):
// - fans out a single tournament's data to every active season tracking it,
//   even across different groups
// - is idempotent: running it twice with unchanged provider data doesn't
//   create a second live_state row, and produces the same scored standings
//   values the second time as the first

import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, liveState, season, standingsSnapshot, tournament, user } from "@/lib/db/schema";
import { createSeason } from "@/lib/seasons/service";
import { ManualProvider } from "@/lib/providers/manual-provider";
import { saveManualStandings } from "@/lib/providers/manual-input";
import { ingestTournament } from "@/lib/providers/ingest";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "@/lib/seasons/test-support";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
  // Belt-and-suspenders: group/tournament cascades already remove these, but
  // an assertion failure mid-test can leave a group ungathered — this
  // keeps failures from leaking rows into later test runs.
  await db.delete(group).where(inArray(group.id, createdGroupIds));
  await db.delete(user).where(inArray(user.id, createdUserIds));
  await db.delete(tournament).where(inArray(tournament.id, createdTournamentIds));
});

async function makeOpenSeasonOnTournament(tournamentId: string): Promise<string> {
  const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
  const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
  await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
  return created.id;
}

describe("ingestTournament", () => {
  it("writes live_state and fans out recompute to every active season on the tournament, across groups", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const seasonAId = await makeOpenSeasonOnTournament(tournamentId);
    const seasonBId = await makeOpenSeasonOnTournament(tournamentId);

    await saveManualStandings(
      db,
      {
        tournamentId,
        tableData: [{ teamId: "mi", played: 3, won: 2, lost: 1, points: 4, nrr: 0.3, position: 1 }],
        statLeaders: { runs: [{ playerId: "player-1", value: 150 }] },
        updatedBy: "test-admin",
      },
      new Date("2026-04-01T00:00:00.000Z")
    );

    const provider = new ManualProvider(db);
    const result = await ingestTournament(db, provider, tournamentId, new Date("2026-04-01T00:05:00.000Z"));

    expect(result.liveState.tournamentId).toBe(tournamentId);
    expect(result.liveState.source).toBe("manual");
    expect(result.liveState.tableData).toEqual([
      { teamId: "mi", played: 3, won: 2, lost: 1, points: 4, nrr: 0.3, position: 1 },
    ]);
    expect(result.liveState.statLeaders).toEqual({ runs: [{ playerId: "player-1", value: 150 }] });

    const recomputedSeasonIds = result.recomputedSnapshots.map((snap) => snap.seasonId).sort();
    expect(recomputedSeasonIds).toEqual([seasonAId, seasonBId].sort());

    const snapshotsA = await db.select().from(standingsSnapshot).where(eq(standingsSnapshot.seasonId, seasonAId));
    const snapshotsB = await db.select().from(standingsSnapshot).where(eq(standingsSnapshot.seasonId, seasonBId));
    expect(snapshotsA).toHaveLength(1);
    expect(snapshotsB).toHaveLength(1);
  });

  it("does not touch a season on a different tournament", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const otherTournamentId = await insertTestTournament(createdTournamentIds);
    const seasonOnThisTournament = await makeOpenSeasonOnTournament(tournamentId);
    const seasonOnOtherTournament = await makeOpenSeasonOnTournament(otherTournamentId);

    await saveManualStandings(
      db,
      {
        tournamentId,
        tableData: [{ teamId: "mi", played: 1, won: 1, lost: 0, points: 2, nrr: 1, position: 1 }],
        statLeaders: {},
        updatedBy: "test-admin",
      },
      new Date("2026-04-01T00:00:00.000Z")
    );

    const provider = new ManualProvider(db);
    const result = await ingestTournament(db, provider, tournamentId, new Date("2026-04-01T00:05:00.000Z"));

    expect(result.recomputedSnapshots.map((snap) => snap.seasonId)).toEqual([seasonOnThisTournament]);
    const snapshotsForOther = await db
      .select()
      .from(standingsSnapshot)
      .where(eq(standingsSnapshot.seasonId, seasonOnOtherTournament));
    expect(snapshotsForOther).toHaveLength(0);
  });

  it("is idempotent: a second run with unchanged input keeps one live_state row and identical scored values", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const seasonId = await makeOpenSeasonOnTournament(tournamentId);

    await saveManualStandings(
      db,
      {
        tournamentId,
        tableData: [{ teamId: "mi", played: 4, won: 3, lost: 1, points: 6, nrr: 0.4, position: 1 }],
        statLeaders: { runs: [{ playerId: "player-1", value: 200 }] },
        updatedBy: "test-admin",
      },
      new Date("2026-04-01T00:00:00.000Z")
    );

    const provider = new ManualProvider(db);
    const first = await ingestTournament(db, provider, tournamentId, new Date("2026-04-01T00:05:00.000Z"));
    const second = await ingestTournament(db, provider, tournamentId, new Date("2026-04-01T00:10:00.000Z"));

    // live_state: exactly one row for this tournament, no duplicate created
    // by the second run.
    const liveStateRows = await db.select().from(liveState).where(eq(liveState.tournamentId, tournamentId));
    expect(liveStateRows).toHaveLength(1);
    expect(liveStateRows[0]?.fetchedAt.toISOString()).toBe(new Date("2026-04-01T00:10:00.000Z").toISOString());

    // standings_snapshot: a fresh row is written each call by design
    // (Session 9), so there are two — but the *scored values* on both must
    // be identical, since nothing about the underlying live_state/picks
    // changed between the two ingestion runs.
    const snapshots = await db
      .select()
      .from(standingsSnapshot)
      .where(eq(standingsSnapshot.seasonId, seasonId));
    expect(snapshots).toHaveLength(2);
    expect(first.recomputedSnapshots[0]?.standings).toEqual(second.recomputedSnapshots[0]?.standings);
  });
});
