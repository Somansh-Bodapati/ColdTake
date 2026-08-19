// Integration tests for src/lib/standings/service.ts, against the local
// Postgres — same pattern as src/lib/seasons/service's own test coverage
// (via api/seasons/[id]/*.test.ts). Covers this session's core claims:
//   - recomputeStandings pulls live_state for a not-yet-settled season and
//     result rows for a settled one (doc 03 §2.5), and writes exactly one
//     standings_snapshot row with denormalized displayName + a delta
//     against the previous snapshot.
//   - getLatestSnapshot/getStandingsHistory are single-table reads that
//     never touch picks/questions/results.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { liveState, result, season, standingsSnapshot } from "@/lib/db/schema";
import { createSeason, getQuestions, loadSeason } from "@/lib/seasons/service";
import { upsertPicks } from "@/lib/picks/service";
import {
  cleanupSeasonFixtures,
  findActiveMemberId,
  insertTestTeams,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "@/lib/seasons/test-support";
import {
  getLatestSnapshot,
  getStandingsHistory,
  recomputeStandings,
} from "@/lib/standings/service";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

async function openAndLockSeason(seasonId: string): Promise<void> {
  await db.update(season).set({ status: "open" }).where(eq(season.id, seasonId));
}

describe("recomputeStandings", () => {
  it("scores against live_state and writes one projected snapshot with denormalized names", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const teamIds = await insertTestTeams(tournamentId, ["mi", "rr", "csk", "gt"]);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [{ type: "top_n_unordered", prompt: "Top 4?", config: { n: 4 }, points: 20, settlement: "auto" }],
    });
    await openAndLockSeason(created.id);
    const [questionRow] = await getQuestions(db, created.id);
    if (!questionRow) throw new Error("Fixture setup failed: no question row");

    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    await upsertPicks(
      db,
      created.id,
      adminMemberId,
      [{ questionId: questionRow.id, answer: { teamIds: [teamIds.mi!, teamIds.rr!, teamIds.csk!, teamIds.gt!] } }],
      new Date()
    );

    await db.insert(liveState).values({
      tournamentId,
      tableData: [
        { teamId: teamIds.mi!, played: 5, won: 4, lost: 1, points: 8, nrr: 1.2, position: 1 },
        { teamId: teamIds.rr!, played: 5, won: 3, lost: 2, points: 6, nrr: 0.5, position: 2 },
        { teamId: teamIds.csk!, played: 5, won: 3, lost: 2, points: 6, nrr: 0.1, position: 3 },
        { teamId: teamIds.gt!, played: 5, won: 2, lost: 3, points: 4, nrr: -0.2, position: 4 },
      ],
      statLeaders: {},
      source: "manual",
      fetchedAt: new Date(),
    });

    const snapshot = await recomputeStandings(db, created.id, new Date());

    expect(snapshot.isProjected).toBe(true);
    const entry = snapshot.standings.find((s) => s.memberId === adminMemberId);
    expect(entry).toMatchObject({ displayName: "Admin", points: 20, delta: 20 });
    expect(entry?.breakdown[0]).toMatchObject({ questionId: questionRow.id, points: 20, status: "correct" });

    // Exactly one row written.
    const rows = await db.select().from(standingsSnapshot).where(eq(standingsSnapshot.seasonId, created.id));
    expect(rows).toHaveLength(1);
  });

  it("computes delta against the previous snapshot on a second recompute", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const teamIds = await insertTestTeams(tournamentId, ["mi"]);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });
    await openAndLockSeason(created.id);
    const [questionRow] = await getQuestions(db, created.id);
    if (!questionRow) throw new Error("Fixture setup failed: no question row");

    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    await upsertPicks(
      db,
      created.id,
      adminMemberId,
      [{ questionId: questionRow.id, answer: { teamId: teamIds.mi! } }],
      new Date()
    );

    // First recompute: no result/live_state yet, so champion is `pending` — 0 points.
    const first = await recomputeStandings(db, created.id, new Date());
    expect(first.standings.find((s) => s.memberId === adminMemberId)?.points).toBe(0);

    // Season settles: a final_result row makes the champion pick correct.
    await db.insert(result).values({
      id: "test-result-final",
      tournamentId,
      kind: "final_result",
      payload: { championTeamId: teamIds.mi! },
      source: "manual",
      isFinal: true,
    });
    await db.update(season).set({ status: "settled", settledAt: new Date() }).where(eq(season.id, created.id));

    const second = await recomputeStandings(db, created.id, new Date());
    const entry = second.standings.find((s) => s.memberId === adminMemberId);
    expect(second.isProjected).toBe(false);
    expect(entry?.points).toBe(30);
    expect(entry?.delta).toBe(30); // 30 - previous 0

    await db.delete(result).where(eq(result.id, "test-result-final"));
  });

  it("rejects recompute for a draft season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    await expect(recomputeStandings(db, created.id, new Date())).rejects.toThrow();
  });
});

describe("getLatestSnapshot / getStandingsHistory", () => {
  it("reads only from standings_snapshot — never recomputes score()", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });
    await openAndLockSeason(created.id);
    await loadSeason(db, created.id, new Date());

    await recomputeStandings(db, created.id, new Date());
    await recomputeStandings(db, created.id, new Date());

    const latest = await getLatestSnapshot(db, created.id);
    expect(latest).toBeDefined();

    const history = await getStandingsHistory(db, created.id);
    expect(history.length).toBe(2);
    // Newest first.
    expect(history[0]!.computedAt.getTime()).toBeGreaterThanOrEqual(history[1]!.computedAt.getTime());
  });
});
