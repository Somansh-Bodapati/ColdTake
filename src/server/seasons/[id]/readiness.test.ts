// Integration tests against the local Postgres, same pattern as
// src/server/seasons/[id]/picks/all.test.ts. Proves GET
// /api/seasons/:id/readiness's auth (admin-only, 403 for a regular member
// and for a non-member) and that it actually surfaces per-member
// completion.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { season } from "../../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../../lib/auth/session";
import { createSeason, getQuestions } from "../../../lib/seasons/service";
import { upsertPicks } from "../../../lib/picks/service";
import {
  cleanupSeasonFixtures,
  findActiveMemberId,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../lib/seasons/test-support";
import handler from "./readiness";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function readinessRequest(seasonId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/readiness`, {
    method: "GET",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("GET /api/seasons/:id/readiness", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(readinessRequest("nonexistent", null));
    expect(response.status).toBe(401);
  });

  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(readinessRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(403);
  });

  it("rejects a non-member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(readinessRequest(created.id, fixture.outsiderSessionToken));
    expect(response.status).toBe(403);
  });

  it("lets the admin see per-member completion", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [{ type: "boolean", prompt: "Will it rain?", config: {}, points: 5, settlement: "manual" }],
    });
    const [q1] = await getQuestions(db, created.id);
    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    await upsertPicks(db, created.id, adminMemberId, [{ questionId: q1!.id, answer: { bool: true } }], new Date());

    const response = await handler(readinessRequest(created.id, fixture.adminSessionToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      members: { memberId: string; displayName: string; missingQuestions: unknown[] }[];
    };
    const adminEntry = body.members.find((m) => m.memberId === adminMemberId);
    const memberEntry = body.members.find((m) => m.memberId !== adminMemberId);
    expect(adminEntry?.missingQuestions).toHaveLength(0);
    expect(memberEntry?.missingQuestions).toHaveLength(1);
  });
});
