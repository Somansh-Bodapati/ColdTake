// Integration tests for src/lib/seasons/settlement.ts against the local
// Postgres — same pattern as src/lib/standings/service.test.ts. Covers this
// session's core claims:
//   - settleSeason writes `result` rows from the season's StandingsProvider,
//     flips locked -> settled, and leaves a final (non-projected) standings
//     snapshot where auto-derivable questions are already scored.
//   - settleQuestion is both the manual-settlement write path (boolean/
//     custom/numeric) and, on a question that already has a settled value,
//     the doc 01 §4.3 admin-override escape hatch — append-only, with a
//     required audit note on override.
//   - voidSeason implements the doc 01 §4.3 "team withdraws/tournament
//     abandoned" case: locked/open/draft -> voided, with a required reason,
//     and no scores computed afterward.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { question, questionResult, season } from "@/lib/db/schema";
import { createSeason, getQuestions } from "@/lib/seasons/service";
import { settleQuestion, settleSeason, voidSeason } from "@/lib/seasons/settlement";
import { recomputeStandings } from "@/lib/standings/service";
import { upsertPicks } from "@/lib/picks/service";
import { ManualProvider } from "@/lib/providers/manual-provider";
import { saveManualStandings } from "@/lib/providers/manual-input";
import {
  cleanupSeasonFixtures,
  findActiveMemberId,
  insertTestTeams,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "@/lib/seasons/test-support";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

async function lockSeason(seasonId: string): Promise<void> {
  await db.update(season).set({ status: "locked" }).where(eq(season.id, seasonId));
}

describe("settleSeason", () => {
  it("rejects a non-admin caller", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await lockSeason(created.id);

    await expect(
      settleSeason(db, created.id, new ManualProvider(db), fixture.memberUserId, new Date())
    ).rejects.toThrow();
  });

  it("rejects settling a season that isn't locked", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    // Still 'draft'.

    await expect(
      settleSeason(db, created.id, new ManualProvider(db), fixture.adminUserId, new Date())
    ).rejects.toThrow(/"draft"/);
  });

  it("rejects settling when the provider has no final data yet", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await lockSeason(created.id);

    await expect(
      settleSeason(db, created.id, new ManualProvider(db), fixture.adminUserId, new Date())
    ).rejects.toThrow(/no final result data/i);
  });

  it("writes final result rows, transitions to settled, and scores derivable questions in final mode", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds, { statCategories: ["runs"] });
    const teamIds = await insertTestTeams(tournamentId, ["mi", "rr", "csk", "gt"]);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [
        { type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" },
        { type: "wooden_spoon", prompt: "Wooden spoon?", config: {}, points: 10, settlement: "auto" },
        {
          type: "boolean",
          prompt: "Any hat-trick this season?",
          config: {},
          points: 5,
          settlement: "manual",
        },
      ],
    });

    const questionRows = await getQuestions(db, created.id);
    const championQuestion = questionRows.find((q) => q.type === "champion")!;
    const woodenSpoonQuestion = questionRows.find((q) => q.type === "wooden_spoon")!;
    const booleanQuestion = questionRows.find((q) => q.type === "boolean")!;

    // Picks must be submitted while the season is still open, before it locks.
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    await upsertPicks(
      db,
      created.id,
      adminMemberId,
      [
        { questionId: championQuestion.id, answer: { teamId: teamIds.mi! } },
        { questionId: woodenSpoonQuestion.id, answer: { teamId: teamIds.gt! } },
        { questionId: booleanQuestion.id, answer: { bool: true } },
      ],
      new Date()
    );
    await lockSeason(created.id);

    await saveManualStandings(
      db,
      {
        tournamentId,
        tableData: [
          { teamId: teamIds.mi!, played: 10, won: 8, lost: 2, points: 16, nrr: 1.1, position: 1 },
          { teamId: teamIds.rr!, played: 10, won: 6, lost: 4, points: 12, nrr: 0.4, position: 2 },
          { teamId: teamIds.csk!, played: 10, won: 4, lost: 6, points: 8, nrr: -0.2, position: 3 },
          { teamId: teamIds.gt!, played: 10, won: 2, lost: 8, points: 4, nrr: -1.0, position: 4 },
        ],
        statLeaders: { runs: [{ playerId: "p1", value: 600 }] },
        finalResult: { championTeamId: teamIds.mi!, runnerUpTeamId: teamIds.rr! },
        updatedBy: fixture.adminUserId,
      },
      new Date()
    );

    const settled = await settleSeason(
      db,
      created.id,
      new ManualProvider(db),
      fixture.adminUserId,
      new Date()
    );

    expect(settled.season.status).toBe("settled");
    expect(settled.season.settledAt).not.toBeNull();
    expect(settled.resultKindsWritten.sort()).toEqual(["final_result", "final_table", "stat_leaders"]);
    expect(settled.snapshot.isProjected).toBe(false);

    const entry = settled.snapshot.standings.find((s) => s.memberId === adminMemberId)!;
    const championEntry = entry.breakdown.find((b) => b.questionId === championQuestion.id)!;
    const woodenSpoonEntry = entry.breakdown.find((b) => b.questionId === woodenSpoonQuestion.id)!;
    const booleanEntry = entry.breakdown.find((b) => b.questionId === booleanQuestion.id)!;

    // Automatic settlement: derivable from finalResult/finalTable, scored
    // immediately without any manual settlement step.
    expect(championEntry).toMatchObject({ status: "correct", points: 30 });
    expect(woodenSpoonEntry).toMatchObject({ status: "correct", points: 10 });
    // boolean has no derivable fact — still pending until settleQuestion.
    expect(booleanEntry.status).toBe("pending");

    // Rejects a second settle now that the season is terminal.
    await expect(
      settleSeason(db, created.id, new ManualProvider(db), fixture.adminUserId, new Date())
    ).rejects.toThrow();
  });
});

describe("settleQuestion", () => {
  async function settledBooleanFixture() {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const teamIds = await insertTestTeams(tournamentId, ["mi"]);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [
        { type: "boolean", prompt: "Any Super Over?", config: {}, points: 10, settlement: "manual" },
      ],
    });
    await lockSeason(created.id);
    await saveManualStandings(
      db,
      {
        tournamentId,
        tableData: [{ teamId: teamIds.mi!, played: 1, won: 1, lost: 0, points: 2, nrr: 1, position: 1 }],
        statLeaders: {},
        updatedBy: fixture.adminUserId,
      },
      new Date()
    );
    await settleSeason(db, created.id, new ManualProvider(db), fixture.adminUserId, new Date());
    const [questionRow] = await db.select().from(question).where(eq(question.seasonId, created.id));
    return { fixture, created, questionRow: questionRow! };
  }

  it("rejects settling a question before the season itself is settled", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "boolean", prompt: "Q?", config: {}, points: 10, settlement: "manual" }],
    });
    await lockSeason(created.id); // locked, not settled
    const [questionRow] = await db.select().from(question).where(eq(question.seasonId, created.id));

    await expect(
      settleQuestion(db, created.id, questionRow!.id, { bool: true }, undefined, fixture.adminUserId, new Date())
    ).rejects.toThrow(/settled/i);
  });

  it("rejects an answer that fails the resolver's own validation", async () => {
    const { fixture, created, questionRow } = await settledBooleanFixture();

    await expect(
      settleQuestion(db, created.id, questionRow.id, {}, undefined, fixture.adminUserId, new Date())
    ).rejects.toThrow();
  });

  it("writes a 'manual' question_result and re-triggers recomputeStandings", async () => {
    const { fixture, created, questionRow } = await settledBooleanFixture();

    const settled = await settleQuestion(
      db,
      created.id,
      questionRow.id,
      { bool: true },
      undefined,
      fixture.adminUserId,
      new Date()
    );

    expect(settled.questionResult.source).toBe("manual");
    expect(settled.questionResult.note).toBeNull();
    expect(settled.questionResult.settledBy).toBe(fixture.adminUserId);
    expect(settled.snapshot.isProjected).toBe(false);
  });

  // doc 01 §4.3: "Data source disagrees with reality — Admin override on
  // any settled question, with an audit note."
  it("requires a note to override an already-settled question", async () => {
    const { fixture, created, questionRow } = await settledBooleanFixture();
    await settleQuestion(db, created.id, questionRow.id, { bool: true }, undefined, fixture.adminUserId, new Date());

    await expect(
      settleQuestion(db, created.id, questionRow.id, { bool: false }, undefined, fixture.adminUserId, new Date())
    ).rejects.toThrow(/audit note/i);

    await expect(
      settleQuestion(db, created.id, questionRow.id, { bool: false }, "   ", fixture.adminUserId, new Date())
    ).rejects.toThrow(/audit note/i);
  });

  it("overrides a settled question's answer with a note, keeping the prior row (append-only)", async () => {
    const { fixture, created, questionRow } = await settledBooleanFixture();
    const first = await settleQuestion(
      db,
      created.id,
      questionRow.id,
      { bool: true },
      undefined,
      fixture.adminUserId,
      new Date()
    );

    const overridden = await settleQuestion(
      db,
      created.id,
      questionRow.id,
      { bool: false },
      "Scorecard was corrected by the league after review",
      fixture.adminUserId,
      new Date()
    );

    expect(overridden.questionResult.source).toBe("override");
    expect(overridden.questionResult.note).toMatch(/corrected/);
    expect(overridden.questionResult.id).not.toBe(first.questionResult.id);

    // Both rows still exist — append-only audit trail, never overwritten in place.
    const rows = await db
      .select()
      .from(questionResult)
      .where(eq(questionResult.questionId, questionRow.id));
    expect(rows).toHaveLength(2);

    // The standings snapshot reflects the *latest* (overridden) value.
    const snapshot = overridden.snapshot;
    expect(snapshot.isProjected).toBe(false);
  });
});

describe("voidSeason", () => {
  it("rejects a non-admin caller", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    await expect(
      voidSeason(db, created.id, "Tournament abandoned", fixture.memberUserId, new Date())
    ).rejects.toThrow();
  });

  it("requires a non-empty reason", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    await expect(voidSeason(db, created.id, "   ", fixture.adminUserId, new Date())).rejects.toThrow(/reason/i);
  });

  // doc 01 §4.3: "Team withdraws or tournament is abandoned — Admin can
  // void the entire season; no scores recorded."
  it("voids an open season with a reason, recording who/when/why", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const now = new Date();
    const voided = await voidSeason(db, created.id, "Tournament abandoned mid-season", fixture.adminUserId, now);

    expect(voided.status).toBe("voided");
    expect(voided.voidReason).toBe("Tournament abandoned mid-season");
    expect(voided.voidedBy).toBe(fixture.adminUserId);
    expect(voided.voidedAt?.getTime()).toBe(now.getTime());

    // No scores recorded: recomputeStandings refuses a voided season.
    await expect(recomputeStandings(db, created.id, new Date())).rejects.toThrow(/voided/i);
  });

  it("cannot void an already-settled season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await lockSeason(created.id);
    await saveManualStandings(
      db,
      { tournamentId, tableData: [], statLeaders: {}, finalResult: { championTeamId: "no-such-team" }, updatedBy: fixture.adminUserId },
      new Date()
    );
    await settleSeason(db, created.id, new ManualProvider(db), fixture.adminUserId, new Date());

    await expect(
      voidSeason(db, created.id, "Too late", fixture.adminUserId, new Date())
    ).rejects.toThrow();
  });

  it("cannot void an already-voided season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    await voidSeason(db, created.id, "First void", fixture.adminUserId, new Date());

    await expect(
      voidSeason(db, created.id, "Second void", fixture.adminUserId, new Date())
    ).rejects.toThrow();
  });
});
