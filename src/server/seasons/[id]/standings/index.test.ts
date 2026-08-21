// GET /api/seasons/:id/standings — doc 03 §3.5: "latest snapshot.
// Cache-Control: s-maxage=300." Session 9's brief: membership-gated, single
// indexed read, no recompute on GET.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db/client";
import { season } from "../../../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/session";
import { createSeason } from "../../../../lib/seasons/service";
import { recomputeStandings } from "../../../../lib/standings/service";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../../lib/seasons/test-support";
import handler from "./index";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function standingsRequest(seasonId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/standings`, {
    method: "GET",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("GET /api/seasons/:id/standings", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(standingsRequest("nonexistent", null));
    expect(response.status).toBe(401);
  });

  it("rejects a non-member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(standingsRequest(created.id, fixture.outsiderSessionToken));
    expect(response.status).toBe(403);
  });

  it("404s before any snapshot has been computed", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(standingsRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(404);
  });

  it("returns the latest snapshot with the caching header, for any member", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    await recomputeStandings(db, created.id, new Date());

    const response = await handler(standingsRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("s-maxage=300");
    const body = (await response.json()) as { seasonId: string; standings: unknown[] };
    expect(body.seasonId).toBe(created.id);
    expect(Array.isArray(body.standings)).toBe(true);
  });
});
