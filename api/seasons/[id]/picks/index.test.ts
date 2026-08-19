// PUT /api/seasons/:id/picks — doc 03 §3.4: upsert, rejected after lock.
// Also covers this session's tasks 2-3: per-question-type validation
// (reusing the same src/lib/scoring/resolvers/*.ts.validate() every
// question type already has) and pick_history's append-only audit trail.

import { afterEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pickHistory, season } from "@/lib/db/schema";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createSeason, getQuestions } from "@/lib/seasons/service";
import {
  cleanupSeasonFixtures,
  insertTestTeams,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "@/lib/seasons/test-support";
import handler from "./index";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function putPicksRequest(seasonId: string, rawToken: string | null, body?: unknown): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/picks`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function makeOpenSeasonWithChampionQuestion(groupId: string, tournamentId: string) {
  const teamIds = await insertTestTeams(tournamentId, ["mi", "rr"]);
  const created = await createSeason(db, {
    groupId,
    tournamentId,
    lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
  });
  await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
  const [questionRow] = await getQuestions(db, created.id);
  if (!questionRow) throw new Error("Fixture setup failed: no question row");
  return { seasonId: created.id, questionId: questionRow.id, teamIds };
}

describe("PUT /api/seasons/:id/picks", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(putPicksRequest("nonexistent", null, { picks: [] }));
    expect(response.status).toBe(401);
  });

  it("rejects a non-member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId, questionId, teamIds } = await makeOpenSeasonWithChampionQuestion(fixture.groupId, tournamentId);

    const response = await handler(
      putPicksRequest(seasonId, fixture.outsiderSessionToken, {
        picks: [{ questionId, answer: { teamId: teamIds.mi } }],
      })
    );
    expect(response.status).toBe(403);
  });

  it("rejects an answer shape the question's resolver doesn't accept (missing teamId)", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId, questionId } = await makeOpenSeasonWithChampionQuestion(fixture.groupId, tournamentId);

    const response = await handler(
      putPicksRequest(seasonId, fixture.memberSessionToken, {
        picks: [{ questionId, answer: {} }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("rejects a team that doesn't belong to this tournament", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId, questionId } = await makeOpenSeasonWithChampionQuestion(fixture.groupId, tournamentId);

    const response = await handler(
      putPicksRequest(seasonId, fixture.memberSessionToken, {
        picks: [{ questionId, answer: { teamId: "not-a-real-team" } }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("rejects a pick for a question that isn't part of this season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId } = await makeOpenSeasonWithChampionQuestion(fixture.groupId, tournamentId);

    const response = await handler(
      putPicksRequest(seasonId, fixture.memberSessionToken, {
        picks: [{ questionId: "not-a-real-question", answer: { teamId: "mi" } }],
      })
    );
    expect(response.status).toBe(400);
  });

  it("upserts a valid pick and echoes it back", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId, questionId, teamIds } = await makeOpenSeasonWithChampionQuestion(fixture.groupId, tournamentId);

    const response = await handler(
      putPicksRequest(seasonId, fixture.memberSessionToken, {
        picks: [{ questionId, answer: { teamId: teamIds.mi } }],
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { picks: { questionId: string; answer: { teamId?: string } }[] };
    expect(body.picks).toHaveLength(1);
    expect(body.picks[0]?.answer.teamId).toBe(teamIds.mi);
  });

  it("rejects writes once the season is locked, with 409", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId, questionId, teamIds } = await makeOpenSeasonWithChampionQuestion(fixture.groupId, tournamentId);
    await db
      .update(season)
      .set({ lockAt: new Date(Date.now() - 60_000) })
      .where(eq(season.id, seasonId));

    const response = await handler(
      putPicksRequest(seasonId, fixture.memberSessionToken, {
        picks: [{ questionId, answer: { teamId: teamIds.mi } }],
      })
    );
    expect(response.status).toBe(409);
  });

  // This session's task 3: every pick change appends to pick_history, and
  // it is never updated or deleted (doc 03 §5 checklist's last line) — a
  // second PUT for the same question changes the live `pick` row (upsert)
  // but must still leave the first history entry intact and add a second.
  it("appends a pick_history row on every change, never overwriting prior rows", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { seasonId, questionId, teamIds } = await makeOpenSeasonWithChampionQuestion(fixture.groupId, tournamentId);

    const first = await handler(
      putPicksRequest(seasonId, fixture.memberSessionToken, {
        picks: [{ questionId, answer: { teamId: teamIds.mi } }],
      })
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { picks: { id: string }[] };
    const pickId = firstBody.picks[0]?.id;
    if (!pickId) throw new Error("Fixture setup failed: no pick id returned");

    const second = await handler(
      putPicksRequest(seasonId, fixture.memberSessionToken, {
        picks: [{ questionId, answer: { teamId: teamIds.rr } }],
      })
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { picks: { id: string; answer: { teamId?: string } }[] };
    // Same pick row (upserted), not a second row — the unique constraint on
    // (question_id, member_id) is what makes this an upsert rather than a
    // duplicate.
    expect(secondBody.picks[0]?.id).toBe(pickId);
    expect(secondBody.picks[0]?.answer.teamId).toBe(teamIds.rr);

    const historyRows = await db
      .select()
      .from(pickHistory)
      .where(eq(pickHistory.pickId, pickId))
      .orderBy(asc(pickHistory.recordedAt));
    expect(historyRows).toHaveLength(2);
    expect(historyRows[0]?.answer.teamId).toBe(teamIds.mi);
    expect(historyRows[1]?.answer.teamId).toBe(teamIds.rr);
  });
});
