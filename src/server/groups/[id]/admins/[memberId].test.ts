// Integration tests against the local Postgres, same pattern as
// src/server/groups/[id]/admins.test.ts. Proves demoteFromAdmin's "a group
// must always have >= 1 admin" invariant at the route level: refuses to
// demote the sole admin, succeeds once a second admin exists, admin-scoped
// (any current admin can demote another).

import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../../../lib/db/client";
import { group, member, user } from "../../../../lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "../../../../lib/auth/session";
import { createGroup, joinGroupByCode, promoteToAdmin } from "../../../../lib/groups/service";
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

function demoteRequest(groupId: string, memberId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/groups/${groupId}/admins/${memberId}`, {
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
  adminMemberId: string;
  memberMemberId: string;
}> {
  const { userId: adminUserId, session: adminSession } = await createAnonymousUser(db, "Admin");
  createdUserIds.push(adminUserId);
  const created = await createGroup(db, { name: "Demotable Group", creatorUserId: adminUserId });
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

describe("DELETE /api/groups/:id/admins/:memberId", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithMember();
    const response = await handler(
      demoteRequest(fixture.groupId, fixture.adminMemberId, fixture.memberSessionToken)
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
      demoteRequest(fixture.groupId, fixture.adminMemberId, outsiderSession.rawToken)
    );
    expect(response.status).toBe(403);
  });

  it("refuses to demote the group's sole admin with a clear 400", async () => {
    const fixture = await makeGroupWithMember();

    const response = await handler(
      demoteRequest(fixture.groupId, fixture.adminMemberId, fixture.adminSessionToken)
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/at least one admin/i);

    const [stillAdmin] = await db.select().from(member).where(eq(member.id, fixture.adminMemberId));
    expect(stillAdmin?.role).toBe("admin");
  });

  it("succeeds once another admin exists", async () => {
    const fixture = await makeGroupWithMember();
    await promoteToAdmin(db, fixture.groupId, fixture.memberMemberId);

    const response = await handler(
      demoteRequest(fixture.groupId, fixture.adminMemberId, fixture.memberSessionToken)
    );
    expect(response.status).toBe(200);

    const [demoted] = await db.select().from(member).where(eq(member.id, fixture.adminMemberId));
    expect(demoted?.role).toBe("member");
    const [stillAdmin] = await db.select().from(member).where(eq(member.id, fixture.memberMemberId));
    expect(stillAdmin?.role).toBe("admin");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const fixture = await makeGroupWithMember();
    const response = await handler(demoteRequest(fixture.groupId, fixture.adminMemberId, null));
    expect(response.status).toBe(401);
  });
});
