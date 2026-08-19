// GET /api/cards/reveal/:seasonId/:timestamp.png — proves the two things
// this route must get right: picks stay invisible before lock (CLAUDE.md
// rule 6, mirrored from api/seasons/[id]/picks/all.test.ts) even though
// this route has no auth gate, and the immutable-URL contract (lock_at is
// the canonical timestamp) matches src/lib/cards/assemble.ts.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { question, season } from "@/lib/db/schema";
import { createSeason } from "@/lib/seasons/service";
import { upsertPicks } from "@/lib/picks/service";
import {
  cleanupSeasonFixtures,
  findActiveMemberId,
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
    `http://localhost/api/cards/reveal/${seasonId}/${encodeURIComponent(timestampSegment)}`,
    { method: "GET" }
  );
}

async function makeLockedSeasonWithPick() {
  const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
  const tournamentId = await insertTestTournament(createdTournamentIds);
  const teamIds = await insertTestTeams(tournamentId, ["csk"]);
  const pastLockAt = new Date(Date.now() - 60_000).toISOString();
  const created = await createSeason(db, {
    groupId: fixture.groupId,
    tournamentId,
    lockAt: pastLockAt,
    questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
  });
  await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

  const memberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
  const [questionRow] = await db.select().from(question).where(eq(question.seasonId, created.id));
  if (questionRow) {
    // Submitted with an explicit `now` still before pastLockAt (CLAUDE.md
    // rule 3: lock state is a function of the `now` passed in, never the
    // real wall clock) — by the time the handler itself runs, real time has
    // already passed pastLockAt and the season reads as locked.
    const beforeLock = new Date(Date.now() - 120_000);
    await upsertPicks(
      db,
      created.id,
      memberId,
      [{ questionId: questionRow.id, answer: { teamId: teamIds.csk } }],
      beforeLock
    );
  }

  return { created, teamIds };
}

describe("GET /api/cards/reveal/:seasonId/:timestamp.png", () => {
  it("403s before lock, even with no auth gate to bypass", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [{ type: "champion", prompt: "Champion?", config: {}, points: 30, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const response = await handler(cardRequest(created.id, "2000-01-01T00:00:00.000Z.png"));
    expect(response.status).toBe(403);
  });

  it("renders once locked, using lock_at as the canonical timestamp", async () => {
    const { created } = await makeLockedSeasonWithPick();

    const [row] = await db.select({ lockAt: season.lockAt }).from(season).where(eq(season.id, created.id));
    const timestamp = row?.lockAt.toISOString();
    if (!timestamp) throw new Error("fixture setup failed");

    const response = await handler(cardRequest(created.id, `${timestamp}.png`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  }, 15000);

  it("404s when the timestamp segment doesn't equal lock_at", async () => {
    const { created } = await makeLockedSeasonWithPick();
    const response = await handler(cardRequest(created.id, "2000-01-01T00:00:00.000Z.png"));
    expect(response.status).toBe(404);
  });
});
