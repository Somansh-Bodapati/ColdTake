import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db/client";
import { question, season } from "../../../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/session";
import { createSeason, getQuestions } from "../../../../lib/seasons/service";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../../lib/seasons/test-support";
import handler from "./[qid]";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function deleteQuestionRequest(seasonId: string, questionId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/questions/${questionId}`, {
    method: "DELETE",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

async function makeSeasonWithQuestion(fixtureGroupId: string, tournamentId: string) {
  const created = await createSeason(db, {
    groupId: fixtureGroupId,
    tournamentId,
    questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
  });
  const [questionRow] = await getQuestions(db, created.id);
  if (!questionRow) throw new Error("Fixture setup failed: no question row");
  return { seasonId: created.id, questionId: questionRow.id };
}

describe("DELETE /api/seasons/:id/questions/:qid", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId, questionId } = await makeSeasonWithQuestion(fixture.groupId, tournamentId);

    const response = await handler(deleteQuestionRequest(seasonId, questionId, fixture.memberSessionToken));
    expect(response.status).toBe(403);
  });

  it("lets the admin remove a question from a draft season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId, questionId } = await makeSeasonWithQuestion(fixture.groupId, tournamentId);

    const response = await handler(deleteQuestionRequest(seasonId, questionId, fixture.adminSessionToken));
    expect(response.status).toBe(200);

    const [row] = await db.select().from(question).where(eq(question.id, questionId));
    expect(row).toBeUndefined();
  });

  it("404s on a question that doesn't belong to this season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId } = await makeSeasonWithQuestion(fixture.groupId, tournamentId);

    const response = await handler(
      deleteQuestionRequest(seasonId, "not-a-real-question-id", fixture.adminSessionToken)
    );
    expect(response.status).toBe(404);
  });

  it("rejects deleting a question once the season is locked, with 409", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId, questionId } = await makeSeasonWithQuestion(fixture.groupId, tournamentId);
    await db
      .update(season)
      .set({ status: "open", lockAt: new Date(Date.now() - 60_000) })
      .where(eq(season.id, seasonId));

    const response = await handler(deleteQuestionRequest(seasonId, questionId, fixture.adminSessionToken));
    expect(response.status).toBe(409);
  });
});
