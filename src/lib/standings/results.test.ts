// Integration tests for src/lib/standings/results.ts against the local
// Postgres. buildResultSetFromLiveState is already exercised end-to-end by
// src/lib/standings/service.test.ts's projected-mode case; this file
// targets buildResultSetFromResults specifically, including Session 12's
// addition — merging this season's latest `question_result` row per
// question into `ResultSet.questionResults`.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { question, questionResult, result } from "@/lib/db/schema";
import { createId } from "@/lib/db/id";
import { createSeason } from "@/lib/seasons/service";
import { cleanupSeasonFixtures, insertTestTournament, makeGroupWithAdminAndMember } from "@/lib/seasons/test-support";
import { buildResultSetFromResults } from "@/lib/standings/results";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];
const createdResultIds: string[] = [];

afterEach(async () => {
  if (createdResultIds.length > 0) {
    await db.delete(result).where(eq(result.id, createdResultIds[0]!));
    createdResultIds.length = 0;
  }
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

describe("buildResultSetFromResults", () => {
  it("merges the latest question_result row per question into questionResults", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [
        { type: "boolean", prompt: "Any 300+ scores?", config: {}, points: 10, settlement: "manual" },
      ],
    });
    const [questionRow] = await db.select().from(question).where(eq(question.seasonId, created.id));
    if (!questionRow) throw new Error("Fixture setup failed: no question row");

    // First settlement, then an override — buildResultSetFromResults must
    // read back only the *latest* row, not the first one.
    await db.insert(questionResult).values({
      id: createId(),
      questionId: questionRow.id,
      answer: { bool: false },
      source: "manual",
      settledBy: fixture.adminUserId,
      settledAt: new Date(Date.now() - 1000),
    });
    await db.insert(questionResult).values({
      id: createId(),
      questionId: questionRow.id,
      answer: { bool: true },
      source: "override",
      note: "Scorecard was corrected after review",
      settledBy: fixture.adminUserId,
      settledAt: new Date(),
    });

    const resultSet = await buildResultSetFromResults(db, tournamentId, created.id);
    expect(resultSet.questionResults).toEqual({ [questionRow.id]: { bool: true } });
  });

  it("omits questionResults entirely when no question has been manually settled", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });

    const resultSet = await buildResultSetFromResults(db, tournamentId, created.id);
    expect(resultSet.questionResults).toBeUndefined();
  });

  it("still reads final_table/final_result/stat_leaders rows scoped by tournament, unaffected by seasonId", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });

    const resultId = createId();
    createdResultIds.push(resultId);
    await db.insert(result).values({
      id: resultId,
      tournamentId,
      kind: "final_result",
      payload: { championTeamId: "team-mi" },
      source: "manual",
      isFinal: true,
    });

    const resultSet = await buildResultSetFromResults(db, tournamentId, created.id);
    expect(resultSet.finalResult).toEqual({ championTeamId: "team-mi" });
  });
});
