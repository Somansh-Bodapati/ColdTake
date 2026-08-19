// Integration tests against the local Postgres (same pattern as
// src/lib/auth/session.test.ts / Session 5's auth tests). Proves the
// group-scoped membership check this session's brief calls out (task 6):
// a non-member gets 403, a member gets 200.

import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, user } from "@/lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createGroup } from "@/lib/groups/service";
import handler from "./index";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];

afterEach(async () => {
  if (createdGroupIds.length > 0) {
    await db.delete(group).where(inArray(group.id, createdGroupIds));
    createdGroupIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
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
    };
    expect(body.group.id).toBe(created.id);
    expect(body.members).toHaveLength(1);
    expect(body.members[0]?.userId).toBe(userId);
    expect(body.members[0]?.role).toBe("admin");
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
