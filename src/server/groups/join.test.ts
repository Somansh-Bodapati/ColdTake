// Integration tests against the local Postgres (same pattern as
// src/lib/auth/session.test.ts / Session 5's auth tests).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../lib/db/client";
import { group, member, user } from "../../lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { createGroup } from "../../lib/groups/service";
import { resetRateLimitForTests } from "../../lib/groups/rate-limit";
import handler from "./join";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];

beforeEach(() => {
  resetRateLimitForTests();
});

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

function joinRequest(rawToken: string | null, body: unknown, ip = "203.0.113.1"): Request {
  return new Request("http://localhost/api/groups/join", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function makeGroup(): Promise<{ groupId: string; joinCode: string; adminUserId: string }> {
  const { userId } = await createAnonymousUser(db, "Group Admin");
  createdUserIds.push(userId);
  const created = await createGroup(db, { name: "Joinable Group", creatorUserId: userId });
  createdGroupIds.push(created.id);
  return { groupId: created.id, joinCode: created.joinCode, adminUserId: userId };
}

describe("POST /api/groups/join", () => {
  it("creates a member row for the authenticated user", async () => {
    const { groupId, joinCode } = await makeGroup();
    const { userId, session } = await createAnonymousUser(db, "Joiner");
    createdUserIds.push(userId);

    const response = await handler(joinRequest(session.rawToken, { joinCode }));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { group: { id: string } };
    expect(body.group.id).toBe(groupId);

    const [memberRow] = await db
      .select()
      .from(member)
      .where(and(eq(member.groupId, groupId), eq(member.userId, userId), isNull(member.removedAt)));
    expect(memberRow?.role).toBe("member");
  });

  it("is idempotent for a user who is already a member", async () => {
    const { groupId, joinCode } = await makeGroup();
    const { userId, session } = await createAnonymousUser(db, "Joiner");
    createdUserIds.push(userId);

    const first = await handler(joinRequest(session.rawToken, { joinCode }));
    expect(first.status).toBe(200);
    const second = await handler(joinRequest(session.rawToken, { joinCode }));
    expect(second.status).toBe(200);

    const memberRows = await db
      .select()
      .from(member)
      .where(and(eq(member.groupId, groupId), eq(member.userId, userId), isNull(member.removedAt)));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.role).toBe("member");
  });

  it("rejects an unknown join code with 404", async () => {
    const { userId, session } = await createAnonymousUser(db, "Joiner");
    createdUserIds.push(userId);

    const response = await handler(joinRequest(session.rawToken, { joinCode: "ZZZZZZ" }));
    expect(response.status).toBe(404);
  });

  it("rejects a malformed join code with 400", async () => {
    const { userId, session } = await createAnonymousUser(db, "Joiner");
    createdUserIds.push(userId);

    const response = await handler(joinRequest(session.rawToken, { joinCode: "AB" }));
    expect(response.status).toBe(400);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { joinCode } = await makeGroup();
    const response = await handler(joinRequest(null, { joinCode }));
    expect(response.status).toBe(401);
  });

  it("rate-limits repeated join attempts from the same IP with 429", async () => {
    const { userId, session } = await createAnonymousUser(db, "Rate Limited");
    createdUserIds.push(userId);
    const ip = "198.51.100.7";

    let lastResponse: Response | null = null;
    for (let i = 0; i < 21; i += 1) {
      lastResponse = await handler(joinRequest(session.rawToken, { joinCode: "ZZZZZZ" }, ip));
    }
    expect(lastResponse?.status).toBe(429);
  });

  it("rejects a non-POST method with 405", async () => {
    const response = await handler(new Request("http://localhost/api/groups/join"));
    expect(response.status).toBe(405);
  });
});
