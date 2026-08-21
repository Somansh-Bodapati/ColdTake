// GET /api/cards/standings/:seasonId/:timestamp.png — proves the immutable-
// URL contract end to end against the real DB: the snapshot's own
// computed_at is the only valid timestamp segment (this session's brief,
// task 4), the response is a real PNG, and it carries the long-lived
// immutable Cache-Control header (task 4) — no auth required (task 6: the
// whole point is that non-members can view it).

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { season } from "@/lib/db/schema";
import { createSeason } from "@/lib/seasons/service";
import { recomputeStandings } from "@/lib/standings/service";
import {
  cleanupSeasonFixtures,
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
    `http://localhost/api/cards/standings/${seasonId}/${encodeURIComponent(timestampSegment)}`,
    { method: "GET" }
  );
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("GET /api/cards/standings/:seasonId/:timestamp.png", () => {
  it("renders the current snapshot as an immutable PNG when the timestamp matches", async () => {
    // Rendering (satori + resvg's WASM init) is slow enough under full-suite
    // parallel load to occasionally miss the default 5s timeout — bump it
    // rather than mock the render pipeline away.
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const snapshot = await recomputeStandings(db, created.id, new Date());
    const timestamp = snapshot.computedAt.toISOString();

    const response = await handler(cardRequest(created.id, `${timestamp}.png`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  }, 15000);

  it("404s when the timestamp segment doesn't match the current snapshot (immutability)", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    await recomputeStandings(db, created.id, new Date());

    const response = await handler(cardRequest(created.id, "2000-01-01T00:00:00.000Z.png"));
    expect(response.status).toBe(404);
  });

  it("404s when no standings have been computed yet", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(cardRequest(created.id, "2000-01-01T00:00:00.000Z.png"));
    expect(response.status).toBe(404);
  });
});
