// Integration tests against the local Postgres (same pattern as
// src/lib/auth/session.test.ts / Session 5's auth tests).

import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, member, user } from "@/lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { JOIN_CODE_PATTERN } from "@/lib/groups/join-code";
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

function postRequest(rawToken: string | null, body: unknown): Request {
  return new Request("http://localhost/api/groups", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/groups", () => {
  it("creates a group and makes the caller its admin member", async () => {
    const { userId, session } = await createAnonymousUser(db, "Group Creator");
    createdUserIds.push(userId);

    const response = await handler(postRequest(session.rawToken, { name: "The Wolfpack" }));
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      group: { id: string; name: string; slug: string; joinCode: string };
      inviteUrl: string;
    };
    createdGroupIds.push(body.group.id);

    expect(body.group.name).toBe("The Wolfpack");
    expect(body.group.joinCode).toMatch(JOIN_CODE_PATTERN);
    expect(body.inviteUrl).toContain(body.group.joinCode);

    const [memberRow] = await db
      .select()
      .from(member)
      .where(and(eq(member.groupId, body.group.id), eq(member.userId, userId), isNull(member.removedAt)));
    expect(memberRow?.role).toBe("admin");
  });

  it("generates a 6-character join code excluding O, 0, I, and 1", async () => {
    const { userId, session } = await createAnonymousUser(db, "Charset Check");
    createdUserIds.push(userId);

    const response = await handler(postRequest(session.rawToken, { name: "Charset Group" }));
    const body = (await response.json()) as { group: { id: string; joinCode: string } };
    createdGroupIds.push(body.group.id);

    expect(body.group.joinCode).toHaveLength(6);
    expect(body.group.joinCode).toBe(body.group.joinCode.toUpperCase());
    for (const char of body.group.joinCode) {
      expect("O0I1").not.toContain(char);
    }
  });

  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(postRequest(null, { name: "No Session" }));
    expect(response.status).toBe(401);
  });

  it("rejects an empty group name with 400", async () => {
    const { userId, session } = await createAnonymousUser(db, "Empty Name");
    createdUserIds.push(userId);

    const response = await handler(postRequest(session.rawToken, { name: "" }));
    expect(response.status).toBe(400);
  });

  it("rejects a non-POST method with 405", async () => {
    const response = await handler(new Request("http://localhost/api/groups"));
    expect(response.status).toBe(405);
  });
});
