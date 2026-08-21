// POST /api/admin/manual-standings/:tournamentId — doc 03 §3.6 [group admin
// or system admin]. Proves the group-admin authorization (this session's
// brief, task 3/5), that a real save writes live_state with source='manual'
// and recomputes the season, and idempotency end-to-end through the route
// (task 6): submitting the exact same body twice leaves the standings
// values unchanged.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { liveState, season, standingsSnapshot } from "../../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../../lib/auth/session";
import { createSeason } from "../../../lib/seasons/service";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../lib/seasons/test-support";
import handler from "./[tournamentId]";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function manualStandingsRequest(tournamentId: string, rawToken: string | null, body: unknown): Request {
  return new Request(`http://localhost/api/admin/manual-standings/${tournamentId}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  tableData: [{ teamId: "mi", played: 3, won: 2, lost: 1, points: 4, nrr: 0.3, position: 1 }],
  statLeaders: { runs: [{ playerId: "player-1", value: 120 }] },
};

describe("POST /api/admin/manual-standings/:tournamentId", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const response = await handler(manualStandingsRequest(tournamentId, null, validBody));
    expect(response.status).toBe(401);
  });

  it("rejects a tournament with no seasons tracking it with 404", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const response = await handler(manualStandingsRequest(tournamentId, fixture.adminSessionToken, validBody));
    expect(response.status).toBe(404);
  });

  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(manualStandingsRequest(tournamentId, fixture.memberSessionToken, validBody));
    expect(response.status).toBe(403);
  });

  it("rejects a malformed body with 400", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(
      manualStandingsRequest(tournamentId, fixture.adminSessionToken, { tableData: [] })
    );
    expect(response.status).toBe(400);
  });

  it("lets the group admin save standings, writing live_state and recomputing the season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const response = await handler(manualStandingsRequest(tournamentId, fixture.adminSessionToken, validBody));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { recomputedSeasonIds: string[] };
    expect(body.recomputedSeasonIds).toEqual([created.id]);

    const [liveStateRow] = await db.select().from(liveState).where(eq(liveState.tournamentId, tournamentId));
    expect(liveStateRow?.source).toBe("manual");
    expect(liveStateRow?.tableData).toEqual(validBody.tableData);
  });

  it("is idempotent: submitting the same body twice keeps live_state to one row with identical standings", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const first = await handler(manualStandingsRequest(tournamentId, fixture.adminSessionToken, validBody));
    expect(first.status).toBe(200);
    const second = await handler(manualStandingsRequest(tournamentId, fixture.adminSessionToken, validBody));
    expect(second.status).toBe(200);

    const liveStateRows = await db.select().from(liveState).where(eq(liveState.tournamentId, tournamentId));
    expect(liveStateRows).toHaveLength(1);

    const snapshots = await db
      .select()
      .from(standingsSnapshot)
      .where(eq(standingsSnapshot.seasonId, created.id));
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.standings).toEqual(snapshots[1]?.standings);
  });
});
