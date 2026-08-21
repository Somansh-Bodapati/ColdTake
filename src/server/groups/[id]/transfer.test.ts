// Integration tests against the local Postgres (same pattern as
// src/lib/auth/session.test.ts / Session 5's auth tests). Proves the
// admin-role check this session's brief calls out (task 6): a non-admin
// member gets 403, the admin gets 200 and the role actually moves.

import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, member, user } from "@/lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createGroup, joinGroupByCode } from "@/lib/groups/service";
import handler from "./transfer";

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

function transferRequest(groupId: string, rawToken: string | null, body: unknown): Request {
  return new Request(`http://localhost/api/groups/${groupId}/transfer`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function makeGroupWithMember(): Promise<{
  groupId: string;
  adminUserId: string;
  adminSessionToken: string;
  memberUserId: string;
  memberSessionToken: string;
  adminMemberId: string;
  memberMemberId: string;
}> {
  const { userId: adminUserId, session: adminSession } = await createAnonymousUser(db, "Admin");
  createdUserIds.push(adminUserId);
  const created = await createGroup(db, { name: "Transferable Group", creatorUserId: adminUserId });
  createdGroupIds.push(created.id);

  const { userId: memberUserId, session: memberSession } = await createAnonymousUser(db, "Member");
  createdUserIds.push(memberUserId);
  await joinGroupByCode(db, { joinCode: created.joinCode, userId: memberUserId });

  const [adminMemberRow] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.groupId, created.id), eq(member.userId, adminUserId), isNull(member.removedAt)));
  const [memberRow] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.groupId, created.id), eq(member.userId, memberUserId), isNull(member.removedAt)));
  if (!adminMemberRow || !memberRow) {
    throw new Error("Fixture setup failed: member rows not found");
  }

  return {
    groupId: created.id,
    adminUserId,
    adminSessionToken: adminSession.rawToken,
    memberUserId,
    memberSessionToken: memberSession.rawToken,
    adminMemberId: adminMemberRow.id,
    memberMemberId: memberRow.id,
  };
}

describe("POST /api/groups/:id/transfer", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithMember();

    const response = await handler(
      transferRequest(fixture.groupId, fixture.memberSessionToken, {
        memberId: fixture.memberMemberId,
      })
    );
    expect(response.status).toBe(403);
  });

  it("rejects a non-member entirely with 403", async () => {
    const fixture = await makeGroupWithMember();
    const { userId: outsiderId, session: outsiderSession } = await createAnonymousUser(
      db,
      "Outsider"
    );
    createdUserIds.push(outsiderId);

    const response = await handler(
      transferRequest(fixture.groupId, outsiderSession.rawToken, {
        memberId: fixture.memberMemberId,
      })
    );
    expect(response.status).toBe(403);
  });

  it("lets the admin transfer the role to another member", async () => {
    const fixture = await makeGroupWithMember();

    const response = await handler(
      transferRequest(fixture.groupId, fixture.adminSessionToken, {
        memberId: fixture.memberMemberId,
      })
    );
    expect(response.status).toBe(200);

    const [newAdmin] = await db.select().from(member).where(eq(member.id, fixture.memberMemberId));
    const [oldAdmin] = await db.select().from(member).where(eq(member.id, fixture.adminMemberId));
    expect(newAdmin?.role).toBe("admin");
    expect(oldAdmin?.role).toBe("member");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const fixture = await makeGroupWithMember();
    const response = await handler(
      transferRequest(fixture.groupId, null, { memberId: fixture.memberMemberId })
    );
    expect(response.status).toBe(401);
  });
});
