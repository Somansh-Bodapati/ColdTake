// Integration tests for GET/PATCH /api/seasons/:id. Also proves the lazy
// lock-state rule (CLAUDE.md rule 3 / doc 03 §4): an 'open' season whose
// lock_at has already passed reads back as 'locked' with no cron involved —
// only this handler's own now() and src/lib/seasons/state.ts's
// effectiveSeasonStatus.

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
import handler from "./index";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function seasonRequest(seasonId: string, method: string, rawToken: string | null, body?: unknown): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("GET /api/seasons/:id", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(seasonRequest("nonexistent", "GET", null));
    expect(response.status).toBe(401);
  });

  it("rejects a non-member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(seasonRequest(created.id, "GET", fixture.outsiderSessionToken));
    expect(response.status).toBe(403);
  });

  it("lets any member (not just admin) read the season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(seasonRequest(created.id, "GET", fixture.memberSessionToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { season: { id: string } };
    expect(body.season.id).toBe(created.id);
  });

  it("derives 'locked' from a past lock_at without any status-writing job having run", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    // Force it open with a lock_at already in the past — simulating a
    // season that should have locked, with no cron ever having touched it.
    await db
      .update(season)
      .set({ status: "open", lockAt: new Date(Date.now() - 60_000) })
      .where(eq(season.id, created.id));

    const response = await handler(seasonRequest(created.id, "GET", fixture.adminSessionToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { season: { status: string } };
    expect(body.season.status).toBe("locked");

    // And it's persisted back (doc 03 §4: "At lock: write member_snapshot"),
    // not just returned transiently.
    const [row] = await db.select().from(season).where(eq(season.id, created.id));
    expect(row?.status).toBe("locked");
  });
});

describe("PATCH /api/seasons/:id", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(
      seasonRequest(created.id, "PATCH", fixture.memberSessionToken, {
        lockAt: "2026-05-01T00:00:00.000Z",
      })
    );
    expect(response.status).toBe(403);
  });

  it("lets the admin move lockAt while draft", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(
      seasonRequest(created.id, "PATCH", fixture.adminSessionToken, {
        lockAt: "2026-05-01T00:00:00.000Z",
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { season: { lockAt: string } };
    expect(body.season.lockAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("rejects edits once the season is locked, with 409", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db
      .update(season)
      .set({ status: "open", lockAt: new Date(Date.now() - 60_000) })
      .where(eq(season.id, created.id));

    const response = await handler(
      seasonRequest(created.id, "PATCH", fixture.adminSessionToken, {
        lockAt: "2026-05-01T00:00:00.000Z",
      })
    );
    expect(response.status).toBe(409);
  });
});
