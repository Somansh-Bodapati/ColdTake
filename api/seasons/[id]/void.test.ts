// Integration test for POST /api/seasons/:id/void — the business logic
// itself is covered thoroughly by src/lib/seasons/settlement.test.ts; this
// just proves the route is wired correctly (admin gate, request validation,
// response shape).

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { season } from "@/lib/db/schema";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createSeason } from "@/lib/seasons/service";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "@/lib/seasons/test-support";
import handler from "./void";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function voidRequest(seasonId: string, rawToken: string | null, body: unknown): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/void`, {
    method: "POST",
    headers: {
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/seasons/:id/void", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(
      voidRequest(created.id, fixture.memberSessionToken, { reason: "Tournament abandoned" })
    );
    expect(response.status).toBe(403);
  });

  it("rejects a request with no reason", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(voidRequest(created.id, fixture.adminSessionToken, { reason: "" }));
    expect(response.status).toBe(400);
  });

  // doc 01 §4.3: "Team withdraws or tournament is abandoned — Admin can
  // void the entire season; no scores recorded."
  it("voids the season with a reason and returns the updated season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const response = await handler(
      voidRequest(created.id, fixture.adminSessionToken, { reason: "Tournament abandoned mid-season" })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.season.status).toBe("voided");
    expect(body.season.voidReason).toBe("Tournament abandoned mid-season");
    expect(body.season.voidedAt).not.toBeNull();
  });
});
