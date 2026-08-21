// GET /api/cards/recap/:seasonId/:timestamp.png — proves the recap card
// only serves once a season is actually settled, and that settled_at is the
// immutable-URL's canonical timestamp (src/lib/cards/assemble.ts).

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { season } from "@/lib/db/schema";
import { createSeason } from "@/lib/seasons/service";
import { settleSeason } from "@/lib/seasons/settlement";
import { ManualProvider } from "@/lib/providers/manual-provider";
import { saveManualStandings } from "@/lib/providers/manual-input";
import {
  cleanupSeasonFixtures,
  insertTestTeams,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "@/lib/seasons/test-support";
import handler from "./[timestamp]";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function cardRequest(seasonId: string, timestampSegment: string): Request {
  return new Request(
    `http://localhost/api/cards/recap/${seasonId}/${encodeURIComponent(timestampSegment)}`,
    { method: "GET" }
  );
}

describe("GET /api/cards/recap/:seasonId/:timestamp.png", () => {
  it("409s (via the route's error mapping) before the season is settled", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "locked" }).where(eq(season.id, created.id));

    const response = await handler(cardRequest(created.id, "2000-01-01T00:00:00.000Z.png"));
    expect(response.status).toBe(409);
  });

  it("renders once settled, using settled_at as the canonical timestamp", async () => {
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

    const now = new Date();
    await settleSeason(db, created.id, new ManualProvider(db), fixture.adminUserId, now);

    const [row] = await db.select({ settledAt: season.settledAt }).from(season).where(eq(season.id, created.id));
    const timestamp = row?.settledAt?.toISOString();
    if (!timestamp) throw new Error("fixture setup failed");

    const response = await handler(cardRequest(created.id, `${timestamp}.png`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  }, 15000);
});
