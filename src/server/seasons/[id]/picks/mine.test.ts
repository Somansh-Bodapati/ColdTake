// GET /api/seasons/:id/picks/mine — doc 03 §3.4: "own picks only," always
// filtered server-side by the authenticated member, never by a client-
// supplied member id.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db/client";
import { season } from "../../../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/session";
import { createSeason, getQuestions } from "../../../../lib/seasons/service";
import { upsertPicks } from "../../../../lib/picks/service";
import {
  cleanupSeasonFixtures,
  findActiveMemberId,
  insertTestTeams,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../../lib/seasons/test-support";
import handler from "./mine";
import putHandler from "./index";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function minePicksRequest(seasonId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/picks/mine`, {
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("GET /api/seasons/:id/picks/mine", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(minePicksRequest("nonexistent", null));
    expect(response.status).toBe(401);
  });

  it("rejects a non-member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(minePicksRequest(created.id, fixture.outsiderSessionToken));
    expect(response.status).toBe(403);
  });

  it("returns only the caller's own picks, never another member's", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const teamIds = await insertTestTeams(tournamentId, ["mi", "rr"]);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    const [questionRow] = await getQuestions(db, created.id);
    if (!questionRow) throw new Error("Fixture setup failed: no question row");

    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    const memberMemberId = await findActiveMemberId(fixture.groupId, fixture.memberUserId);
    await upsertPicks(db, created.id, adminMemberId, [{ questionId: questionRow.id, answer: { teamId: teamIds.mi } }], new Date());
    await upsertPicks(db, created.id, memberMemberId, [{ questionId: questionRow.id, answer: { teamId: teamIds.rr } }], new Date());

    const response = await handler(minePicksRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { picks: { answer: { teamId?: string } }[] };
    expect(body.picks).toHaveLength(1);
    expect(body.picks[0]?.answer.teamId).toBe(teamIds.rr);
  });

  it("is visible to the owner even before lock (privacy only restricts other members)", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const teamIds = await insertTestTeams(tournamentId, ["mi"]);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    const [questionRow] = await getQuestions(db, created.id);
    if (!questionRow) throw new Error("Fixture setup failed: no question row");

    const putResponse = await putHandler(
      new Request(`http://localhost/api/seasons/${created.id}/picks`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${fixture.memberSessionToken}`,
        },
        body: JSON.stringify({ picks: [{ questionId: questionRow.id, answer: { teamId: teamIds.mi } }] }),
      })
    );
    expect(putResponse.status).toBe(200);

    const response = await handler(minePicksRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { picks: { answer: { teamId?: string } }[] };
    expect(body.picks).toHaveLength(1);
    expect(body.picks[0]?.answer.teamId).toBe(teamIds.mi);
  });
});
