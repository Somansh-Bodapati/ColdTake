// Integration tests against the local Postgres (same pattern as
// src/lib/auth/session.test.ts / Session 5's auth tests). Proves the
// group-scoped membership check this session's brief calls out (task 6):
// a non-member gets 403, a member gets 200.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { season } from "../../../lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "../../../lib/auth/session";
import { createGroup } from "../../../lib/groups/service";
import { createSeason } from "../../../lib/seasons/service";
import { cleanupSeasonFixtures, insertTestTournament } from "../../../lib/seasons/test-support";
import handler from "./index";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function getRequest(groupId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/groups/${groupId}`, {
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

async function makeGroup(): Promise<{ groupId: string; adminUserId: string }> {
  const { userId } = await createAnonymousUser(db, "Group Admin");
  createdUserIds.push(userId);
  const created = await createGroup(db, { name: "Scoped Group", creatorUserId: userId });
  createdGroupIds.push(created.id);
  return { groupId: created.id, adminUserId: userId };
}

describe("GET /api/groups/:id", () => {
  it("rejects a non-member with 403", async () => {
    const { groupId } = await makeGroup();
    const { userId: outsiderId, session: outsiderSession } = await createAnonymousUser(
      db,
      "Outsider"
    );
    createdUserIds.push(outsiderId);

    const response = await handler(getRequest(groupId, outsiderSession.rawToken));
    expect(response.status).toBe(403);
  });

  it("returns the group and member list for an actual member", async () => {
    const { userId, session } = await createAnonymousUser(db, "Group Admin");
    createdUserIds.push(userId);
    const created = await createGroup(db, { name: "Member Sees This", creatorUserId: userId });
    createdGroupIds.push(created.id);

    const response = await handler(getRequest(created.id, session.rawToken));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      group: { id: string; name: string };
      members: { userId: string; role: string }[];
      seasons: { id: string; status: string }[];
    };
    expect(body.group.id).toBe(created.id);
    expect(body.members).toHaveLength(1);
    expect(body.members[0]?.userId).toBe(userId);
    expect(body.members[0]?.role).toBe("admin");
    // Empty-state fix (this hardening session): a brand-new group has no
    // seasons yet, and the response must say so explicitly (an empty array)
    // rather than omitting the field — src/routes/group.tsx renders its
    // "no seasons yet" copy off exactly this.
    expect(body.seasons).toEqual([]);
  });

  // This hardening session's fix: before it, GET /api/groups/:id never
  // returned seasons at all, so there was no way for the group page to link
  // a member into a season it already had. Proves the list now comes back,
  // with the lazily-derived effective status (src/lib/seasons/state.ts),
  // not the raw stored column.
  it("includes the group's seasons, with lazily-derived effective status", async () => {
    const { userId, session } = await createAnonymousUser(db, "Group Admin");
    createdUserIds.push(userId);
    const created = await createGroup(db, { name: "Group With A Season", creatorUserId: userId });
    createdGroupIds.push(created.id);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const seasonRow = await createSeason(db, {
      groupId: created.id,
      tournamentId,
      lockAt: new Date(Date.now() - 60_000).toISOString(), // already in the past
      questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, seasonRow.id));

    const response = await handler(getRequest(created.id, session.rawToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { seasons: { id: string; status: string }[] };
    expect(body.seasons).toHaveLength(1);
    expect(body.seasons[0]?.id).toBe(seasonRow.id);
    // Stored status is still "open" — this must reflect lock_at having
    // already passed (CLAUDE.md rule 3: lock state computed on read).
    expect(body.seasons[0]?.status).toBe("locked");
  });

  it("returns 404 for a group that doesn't exist", async () => {
    const { userId, session } = await createAnonymousUser(db, "Someone");
    createdUserIds.push(userId);

    const response = await handler(getRequest("does-not-exist", session.rawToken));
    expect(response.status).toBe(404);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { groupId } = await makeGroup();
    const response = await handler(getRequest(groupId, null));
    expect(response.status).toBe(401);
  });
});
