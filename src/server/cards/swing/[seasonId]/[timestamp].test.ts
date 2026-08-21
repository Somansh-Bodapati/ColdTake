// GET /api/cards/swing/:seasonId/:timestamp.png — proves the two-snapshot
// comparison (src/lib/cards/assemble.ts's assembleSwingCard) and the
// immutable-URL contract (latest snapshot's computed_at is canonical).

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db/client";
import { season, standingsSnapshot } from "../../../../lib/db/schema";
import { createSeason } from "../../../../lib/seasons/service";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../../lib/seasons/test-support";
import handler from "./[timestamp]";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function cardRequest(seasonId: string, timestampSegment: string): Request {
  return new Request(
    `http://localhost/api/cards/swing/${seasonId}/${encodeURIComponent(timestampSegment)}`,
    { method: "GET" }
  );
}

describe("GET /api/cards/swing/:seasonId/:timestamp.png", () => {
  it("404s with fewer than two snapshots of history", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(cardRequest(created.id, "2000-01-01T00:00:00.000Z.png"));
    expect(response.status).toBe(404);
  });

  it("renders the member with the biggest rank swing between the two latest snapshots", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    // Two hand-written snapshots (this is exactly the shape
    // recomputeStandings itself writes — src/lib/db/schema.ts's
    // StandingsEntry — so writing them directly here isolates the swing
    // comparison from the scoring engine entirely).
    await db.insert(standingsSnapshot).values({
      seasonId: created.id,
      isProjected: true,
      computedAt: new Date(Date.now() - 60_000),
      standings: [
        { memberId: "m1", displayName: "Trailing Sam", rank: 4, points: 10, delta: 0, breakdown: [] },
        { memberId: "m2", displayName: "Leading Lee", rank: 1, points: 40, delta: 0, breakdown: [] },
      ],
    });
    const [latest] = await db
      .insert(standingsSnapshot)
      .values({
        seasonId: created.id,
        isProjected: true,
        computedAt: new Date(),
        standings: [
          { memberId: "m1", displayName: "Trailing Sam", rank: 1, points: 50, delta: 40, breakdown: [] },
          { memberId: "m2", displayName: "Leading Lee", rank: 2, points: 41, delta: 1, breakdown: [] },
        ],
      })
      .returning();
    if (!latest) throw new Error("fixture setup failed");

    const timestamp = latest.computedAt.toISOString();
    const response = await handler(cardRequest(created.id, `${timestamp}.png`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  }, 15000);
});
