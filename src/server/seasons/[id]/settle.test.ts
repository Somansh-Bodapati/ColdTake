// Integration test for POST /api/seasons/:id/settle — the business logic
// itself is covered thoroughly by src/lib/seasons/settlement.test.ts; this
// just proves the route is wired correctly (admin gate, provider lookup,
// response shape).

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { season } from "@/lib/db/schema";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createSeason } from "@/lib/seasons/service";
import { saveManualStandings } from "@/lib/providers/manual-input";
import {
  cleanupSeasonFixtures,
  insertTestTeams,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "@/lib/seasons/test-support";
import handler from "./settle";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function settleRequest(seasonId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/settle`, {
    method: "POST",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("POST /api/seasons/:id/settle", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "locked" }).where(eq(season.id, created.id));

    const response = await handler(settleRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(403);
  });

  it("settles a locked season from the configured (manual) provider", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const teamIds = await insertTestTeams(tournamentId, ["mi"]);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });
    await db.update(season).set({ status: "locked" }).where(eq(season.id, created.id));
    await saveManualStandings(
      db,
      {
        tournamentId,
        tableData: [{ teamId: teamIds.mi!, played: 1, won: 1, lost: 0, points: 2, nrr: 1, position: 1 }],
        statLeaders: {},
        finalResult: { championTeamId: teamIds.mi! },
        updatedBy: fixture.adminUserId,
      },
      new Date()
    );

    const response = await handler(settleRequest(created.id, fixture.adminSessionToken));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.season.status).toBe("settled");
    expect(body.standings.isProjected).toBe(false);
    expect(body.resultKindsWritten).toContain("final_result");
  });
});
