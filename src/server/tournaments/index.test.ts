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

  it("returns the tournament catalogue", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const { userId, session } = await createAnonymousUser(db, "Catalogue Viewer");
    createdUserIds.push(userId);

    const response = await handler(catalogueRequest(session.rawToken));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { tournaments: Array<{ id: string }> };
    expect(body.tournaments.some((t) => t.id === tournamentId)).toBe(true);
  });

  // Real bug, reported live: an admin created a tournament (201), reopened
  // season setup immediately, and still saw the pre-creation list. Root
  // cause was this endpoint's own `Cache-Control: public, max-age=300` --
  // "public" is honored by Vercel's shared edge cache, not just the
  // requesting browser, so a client-side `cache: "no-store"` fetch option
  // (which only bypasses the *browser's* local cache) couldn't force a
  // fresh read. No Cache-Control at all now, on purpose.
  it("sets no Cache-Control header, so no shared cache can serve a stale list", async () => {
    await insertTestTournament(createdTournamentIds);
    const { userId, session } = await createAnonymousUser(db, "Catalogue Viewer");
    createdUserIds.push(userId);

    const response = await handler(catalogueRequest(session.rawToken));
    expect(response.headers.get("Cache-Control")).toBeNull();
  });
});
