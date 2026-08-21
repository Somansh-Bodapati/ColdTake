import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db/client";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { insertTestTournament, cleanupSeasonFixtures } from "../../lib/seasons/test-support";
import handler from "./index";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function catalogueRequest(rawToken: string | null): Request {
  return new Request("http://localhost/api/tournaments", {
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("GET /api/tournaments", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(catalogueRequest(null));
    expect(response.status).toBe(401);
  });

  it("returns the tournament catalogue with a Cache-Control header", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { userId, session } = await createAnonymousUser(db, "Catalogue Viewer");
    createdUserIds.push(userId);

    const response = await handler(catalogueRequest(session.rawToken));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("max-age");

    const body = (await response.json()) as { tournaments: Array<{ id: string }> };
    expect(body.tournaments.some((t) => t.id === tournamentId)).toBe(true);
  });
});
