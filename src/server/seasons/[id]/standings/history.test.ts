// GET /api/seasons/:id/standings/history — doc 03 §3.5: "position over time
// for the chart." Same membership gate and read discipline as ./index.ts.

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
import handler from "./history";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function historyRequest(seasonId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/standings/history`, {
    method: "GET",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("GET /api/seasons/:id/standings/history", () => {
  it("rejects a non-member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(historyRequest(created.id, fixture.outsiderSessionToken));
    expect(response.status).toBe(403);
  });

  it("returns an empty list before any snapshot exists, and every snapshot after multiple recomputes", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const empty = await handler(historyRequest(created.id, fixture.memberSessionToken));
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { snapshots: unknown[] }).snapshots).toHaveLength(0);

    await recomputeStandings(db, created.id, new Date());
    await recomputeStandings(db, created.id, new Date());

    const response = await handler(historyRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("s-maxage=300");
    const body = (await response.json()) as { snapshots: unknown[] };
    expect(body.snapshots).toHaveLength(2);
  });
});
