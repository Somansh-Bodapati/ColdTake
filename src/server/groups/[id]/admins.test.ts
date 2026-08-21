// Integration tests against the local Postgres (same pattern as
// src/lib/auth/session.test.ts / Session 5's auth tests). Multi-admin support
// (this session's fix): promoting is non-destructive — the caller stays
// admin — and ANY current admin (not a single "the" admin) can promote
// someone else. Replaces the old destructive POST /api/groups/:id/transfer.

import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { group, member, user } from "../../../lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "../../../lib/auth/session";
import { createGroup, joinGroupByCode, promoteToAdmin } from "../../../lib/groups/service";
import handler from "./admins";

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

function promoteRequest(groupId: string, rawToken: string | null, body: unknown): Request {
  return new Request(`http://localhost/api/groups/${groupId}/admins`, {
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
  const created = await createGroup(db, { name: "Promotable Group", creatorUserId: adminUserId });
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

describe("POST /api/groups/:id/admins", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithMember();

    const response = await handler(
      promoteRequest(fixture.groupId, fixture.memberSessionToken, {
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
      promoteRequest(fixture.groupId, outsiderSession.rawToken, {
        memberId: fixture.memberMemberId,
      })
    );
    expect(response.status).toBe(403);
  });

  it("lets an admin promote another member, keeping their own admin role", async () => {
    const fixture = await makeGroupWithMember();

    const response = await handler(
      promoteRequest(fixture.groupId, fixture.adminSessionToken, {
        memberId: fixture.memberMemberId,
      })
    );
    expect(response.status).toBe(200);

    const [newAdmin] = await db.select().from(member).where(eq(member.id, fixture.memberMemberId));
    const [originalAdmin] = await db.select().from(member).where(eq(member.id, fixture.adminMemberId));
    expect(newAdmin?.role).toBe("admin");
    // The whole point of this fix: the caller who promoted someone else
    // must NOT lose their own admin role.
    expect(originalAdmin?.role).toBe("admin");
  });

  it("promoting an already-admin member is a no-op, not an error", async () => {
    const fixture = await makeGroupWithMember();
    await promoteToAdmin(db, fixture.groupId, fixture.memberMemberId);

    const response = await handler(
      promoteRequest(fixture.groupId, fixture.adminSessionToken, {
        memberId: fixture.memberMemberId,
      })
    );
    expect(response.status).toBe(200);

    const [stillAdmin] = await db.select().from(member).where(eq(member.id, fixture.memberMemberId));
    expect(stillAdmin?.role).toBe("admin");
  });

  it("lets any current admin (not just the original) promote someone else", async () => {
    const fixture = await makeGroupWithMember();
    // Promote the member first, so the group now has two admins.
    await promoteToAdmin(db, fixture.groupId, fixture.memberMemberId);

    const { userId: thirdUserId } = await createAnonymousUser(db, "Third");
    createdUserIds.push(thirdUserId);
    const created = await db
      .select({ joinCode: group.joinCode })
      .from(group)
      .where(eq(group.id, fixture.groupId));
    await joinGroupByCode(db, { joinCode: created[0]!.joinCode, userId: thirdUserId });
    const [thirdMemberRow] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.groupId, fixture.groupId), eq(member.userId, thirdUserId), isNull(member.removedAt)));

    // The second admin (previously a plain member) promotes the third.
    const response = await handler(
      promoteRequest(fixture.groupId, fixture.memberSessionToken, {
        memberId: thirdMemberRow!.id,
      })
    );
    expect(response.status).toBe(200);
    const [thirdRow] = await db.select().from(member).where(eq(member.id, thirdMemberRow!.id));
    expect(thirdRow?.role).toBe("admin");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const fixture = await makeGroupWithMember();
    const response = await handler(
      promoteRequest(fixture.groupId, null, { memberId: fixture.memberMemberId })
    );
    expect(response.status).toBe(401);
  });
});
