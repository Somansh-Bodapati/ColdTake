import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { season } from "../../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../../lib/auth/session";
import { createSeason } from "../../../lib/seasons/service";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../lib/seasons/test-support";
import handler from "./publish";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function publishRequest(seasonId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/publish`, {
    method: "POST",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("POST /api/seasons/:id/publish", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: "2099-01-01T00:00:00.000Z",
      questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
    });

    const response = await handler(publishRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(403);
  });

  it("rejects publishing a draft with no questions, with 400", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: "2099-01-01T00:00:00.000Z",
      questions: [],
    });

    const response = await handler(publishRequest(created.id, fixture.adminSessionToken));
    expect(response.status).toBe(400);
  });

  it("rejects publishing when lockAt is already in the past, with 400", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: "2020-01-01T00:00:00.000Z",
      questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
    });

    const response = await handler(publishRequest(created.id, fixture.adminSessionToken));
    expect(response.status).toBe(400);
  });

  it("lets the admin publish a valid draft: draft -> open", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: "2099-01-01T00:00:00.000Z",
      questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
    });

    const response = await handler(publishRequest(created.id, fixture.adminSessionToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { season: { status: string } };
    expect(body.season.status).toBe("open");

    const [row] = await db.select().from(season).where(eq(season.id, created.id));
    expect(row?.status).toBe("open");
  });

  it("rejects publishing an already-open season a second time, with 409", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: "2099-01-01T00:00:00.000Z",
      questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
    });
    const first = await handler(publishRequest(created.id, fixture.adminSessionToken));
    expect(first.status).toBe(200);

    const second = await handler(publishRequest(created.id, fixture.adminSessionToken));
    expect(second.status).toBe(409);
  });
});
