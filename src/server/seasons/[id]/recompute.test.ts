// POST /api/seasons/:id/recompute — doc 03 §3.5 [admin, rate-limited]. The
// only write path onto standings_snapshot; proves admin-only, that a real
// snapshot row lands, and that the rate limit engages.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { season, standingsSnapshot } from "../../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../../lib/auth/session";
import { createSeason } from "../../../lib/seasons/service";
import { resetRateLimitForTests } from "../../../lib/groups/rate-limit";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../lib/seasons/test-support";
import handler from "./recompute";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

beforeEach(() => {
  resetRateLimitForTests();
});

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function recomputeRequest(seasonId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/recompute`, {
    method: "POST",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("POST /api/seasons/:id/recompute", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const response = await handler(recomputeRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(403);
  });

  it("lets the admin write a new standings_snapshot row", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const response = await handler(recomputeRequest(created.id, fixture.adminSessionToken));
    expect(response.status).toBe(201);

    const rows = await db.select().from(standingsSnapshot).where(eq(standingsSnapshot.seasonId, created.id));
    expect(rows).toHaveLength(1);
  });

  it("rate-limits repeated recompute calls for the same season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    let sawRateLimited = false;
    for (let i = 0; i < 15; i += 1) {
      const response = await handler(recomputeRequest(created.id, fixture.adminSessionToken));
      if (response.status === 429) {
        sawRateLimited = true;
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
  });
});
