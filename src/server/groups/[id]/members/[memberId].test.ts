// Integration tests against the local Postgres (same pattern as
// src/lib/auth/session.test.ts / Session 5's auth tests). Proves the
// admin-role check this session's brief calls out (task 6): a non-admin
// member gets 403, the admin gets 200.

import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, member, user } from "@/lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createGroup, joinGroupByCode } from "@/lib/groups/service";
import handler from "./[memberId]";

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

function deleteRequest(groupId: string, memberId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/groups/${groupId}/members/${memberId}`, {
    method: "DELETE",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

async function makeGroupWithMember(): Promise<{
  groupId: string;
  adminUserId: string;
  adminSessionToken: string;
  memberUserId: string;
  memberSessionToken: string;
  memberMemberId: string;
}> {
  const { userId: adminUserId, session: adminSession } = await createAnonymousUser(db, "Admin");
  createdUserIds.push(adminUserId);
  const created = await createGroup(db, { name: "Removable Group", creatorUserId: adminUserId });
  createdGroupIds.push(created.id);

  const { userId: memberUserId, session: memberSession } = await createAnonymousUser(db, "Member");
  createdUserIds.push(memberUserId);
  await joinGroupByCode(db, { joinCode: created.joinCode, userId: memberUserId });

  const [memberRow] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.groupId, created.id), eq(member.userId, memberUserId), isNull(member.removedAt)));
  if (!memberRow) {
    throw new Error("Fixture setup failed: member row not found");
  }

  return {
    groupId: created.id,
    adminUserId,
    adminSessionToken: adminSession.rawToken,
    memberUserId,
    memberSessionToken: memberSession.rawToken,
    memberMemberId: memberRow.id,
  };
}

describe("DELETE /api/groups/:id/members/:mid", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithMember();

    const response = await handler(
      deleteRequest(fixture.groupId, fixture.memberMemberId, fixture.memberSessionToken)
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
      deleteRequest(fixture.groupId, fixture.memberMemberId, outsiderSession.rawToken)
    );
    expect(response.status).toBe(403);
  });

  it("lets the admin remove a member", async () => {
    const fixture = await makeGroupWithMember();

    const response = await handler(
      deleteRequest(fixture.groupId, fixture.memberMemberId, fixture.adminSessionToken)
    );
    expect(response.status).toBe(200);

    const [removed] = await db.select().from(member).where(eq(member.id, fixture.memberMemberId));
    expect(removed?.removedAt).not.toBeNull();
  });

  it("refuses to remove the admin without a transfer first", async () => {
    const fixture = await makeGroupWithMember();
    const [adminMemberRow] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.groupId, fixture.groupId), eq(member.userId, fixture.adminUserId)));

    // Safe: makeGroupWithMember always creates the admin's member row first.
    const response = await handler(
      deleteRequest(fixture.groupId, adminMemberRow!.id, fixture.adminSessionToken)
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const fixture = await makeGroupWithMember();
    const response = await handler(deleteRequest(fixture.groupId, fixture.memberMemberId, null));
    expect(response.status).toBe(401);
  });
});
