// DB-backed group logic: creation, joining, membership/admin checks, and
// admin actions (remove member, transfer admin). Mirrors the style of
// src/lib/auth/session.ts — one file holding the queries plus the small
// amount of business logic around them, imported directly by api/groups/*.

import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import { group, member, user, type MemberRole } from "../db/schema.js";
import { createId } from "../db/id.js";
import { generateJoinCode } from "./join-code.js";
import { slugifyGroupName } from "./slug.js";
import { AppError } from "../errors.js";
import type { GroupMember, GroupSummary } from "../schemas/groups.js";

const MAX_GENERATION_ATTEMPTS = 5;

// node-postgres surfaces a unique-violation as an error with `.code ===
// '23505'` and `.constraint` set to the constraint name (see the migration:
// group_slug_unique / group_join_code_unique). Narrowed like this instead of
// importing a pg error type, since the shape is the same across the
// node-postgres and neon-http drivers this project swaps between (doc
// 02/DECISIONS.md driver-compatibility requirement).
function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505" &&
    "constraint" in error &&
    (error as { constraint?: unknown }).constraint === constraint
  );
}

function randomSlugSuffix(): string {
  // Reuses the join-code alphabet (unambiguous, uniform) lowercased, just
  // for a short unique-ifying suffix on the slug — not a security token.
  return generateJoinCode().toLowerCase().slice(0, 6);
}

// Creates a group and makes `creatorUserId` its sole admin member. Doc 01
// §2.1 step 4: "Group is created with them as admin; an invite link +
// 6-character join code is generated." Retries slug/join-code generation on
// the rare unique-constraint collision instead of trusting one shot.
export async function createGroup(
  db: Db,
  args: { name: string; creatorUserId: string }
): Promise<GroupSummary> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const groupId = createId();
    const base = slugifyGroupName(args.name) || "group";
    const slug = `${base}-${randomSlugSuffix()}`;
    const joinCode = generateJoinCode();

    try {
      const [row] = await db
        .insert(group)
        .values({
          id: groupId,
          name: args.name,
          slug,
          joinCode,
          createdBy: args.creatorUserId,
        })
        .returning();

      if (!row) {
        throw new AppError(500, "Failed to create group");
      }

      await db.insert(member).values({
        id: createId(),
        groupId: row.id,
        userId: args.creatorUserId,
        role: "admin",
      });

      return { id: row.id, name: row.name, slug: row.slug, joinCode: row.joinCode };
    } catch (error) {
      if (isUniqueViolation(error, "group_slug_unique") || isUniqueViolation(error, "group_join_code_unique")) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AppError(500, "Could not generate a unique group slug/join code");
}

// Joins the authenticated user to the group identified by `joinCode`. doc
// 03 §3.2. Idempotent: re-joining a group you're already an active member
// of, or rejoining one you'd been removed from, just (re)activates the
// membership row rather than erroring, via the (group_id, user_id) unique
// constraint's onConflictDoUpdate path.
export async function joinGroupByCode(
  db: Db,
  args: { joinCode: string; userId: string }
): Promise<GroupSummary> {
  const [row] = await db
    .select({ id: group.id, name: group.name, slug: group.slug, joinCode: group.joinCode })
    .from(group)
    .where(and(eq(group.joinCode, args.joinCode), isNull(group.archivedAt)))
    .limit(1);

  if (!row) {
    throw new AppError(404, "Invalid join code");
  }

  await db
    .insert(member)
    .values({ id: createId(), groupId: row.id, userId: args.userId, role: "member" })
    .onConflictDoUpdate({
      target: [member.groupId, member.userId],
      set: { removedAt: null },
    });

  return row;
}

// Session 13's share cards (src/lib/cards/assemble.ts) and the public
// join-preview endpoint (api/groups/by-code/[code].ts) both need just the
// name/joinCode pair, not the full member list getGroupDetail assembles —
// kept as its own query rather than reusing getGroupDetail and discarding
// `members`, since a card is rendered per request and shouldn't pay for a
// member-list join it never reads.
export async function getGroupBranding(
  db: Db,
  groupId: string
): Promise<{ name: string; joinCode: string }> {
  const [row] = await db
    .select({ name: group.name, joinCode: group.joinCode })
    .from(group)
    .where(eq(group.id, groupId))
    .limit(1);
  if (!row) {
    throw new AppError(404, "Group not found");
  }
  return row;
}

// Public join-preview lookup (no auth, no membership check) — the join-by-
// code landing page (this session's brief, task 6) needs the group's name
// before the visitor has signed in or joined, same reasoning as
// joinGroupByCode's own lookup but read-only.
export async function getGroupByJoinCode(
  db: Db,
  joinCode: string
): Promise<{ id: string; name: string }> {
  const [row] = await db
    .select({ id: group.id, name: group.name })
    .from(group)
    .where(and(eq(group.joinCode, joinCode), isNull(group.archivedAt)))
    .limit(1);
  if (!row) {
    throw new AppError(404, "Invalid join code");
  }
  return row;
}

export interface GroupDetail {
  group: GroupSummary;
  members: GroupMember[];
}

export async function getGroupDetail(db: Db, groupId: string): Promise<GroupDetail> {
  const [groupRow] = await db
    .select({ id: group.id, name: group.name, slug: group.slug, joinCode: group.joinCode })
    .from(group)
    .where(eq(group.id, groupId))
    .limit(1);

  if (!groupRow) {
    throw new AppError(404, "Group not found");
  }

  const memberRows = await db
    .select({
      id: member.id,
      userId: member.userId,
      displayName: user.displayName,
      role: member.role,
      joinedAt: member.joinedAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.groupId, groupId), isNull(member.removedAt)));

  return {
    group: groupRow,
    members: memberRows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() })),
  };
}

export interface MembershipCheck {
  memberId: string;
  role: MemberRole;
}

// Every group-scoped endpoint must call this (this session's brief, task 6)
// after requireUser. Throws 404 if the group itself doesn't exist, 403 if
// it exists but the caller isn't an active member of it — a caller should
// not be able to distinguish "group doesn't exist" from "you're not in it"
// via a 403 (both already read as "you can't see this"), so 404 for the
// former is fine and simpler than uniformly masking it as 403.
//
// One indexed left-join query rather than a "does the group exist" select
// followed by a separate "is this user a member" select (Session 16's cost
// audit, docs/DECISIONS.md's Neon-CU-hours constraint): this function sits
// underneath nearly every group- and season-scoped read/write in the API
// surface, so the second round trip it used to cost was paid on almost
// every request in the app.
export async function requireMembership(
  db: Db,
  groupId: string,
  userId: string
): Promise<MembershipCheck> {
  const [row] = await db
    .select({ groupId: group.id, memberId: member.id, role: member.role })
    .from(group)
    .leftJoin(
      member,
      and(eq(member.groupId, group.id), eq(member.userId, userId), isNull(member.removedAt))
    )
    .where(eq(group.id, groupId))
    .limit(1);

  if (!row) {
    throw new AppError(404, "Group not found");
  }
  if (!row.memberId || !row.role) {
    throw new AppError(403, "You are not a member of this group");
  }

  return { memberId: row.memberId, role: row.role };
}

// Every admin endpoint must call this (this session's brief, task 6).
export async function requireAdmin(db: Db, groupId: string, userId: string): Promise<MembershipCheck> {
  const membership = await requireMembership(db, groupId, userId);
  if (membership.role !== "admin") {
    throw new AppError(403, "Admin role required for this group");
  }
  return membership;
}

// Soft-deletes a member (removedAt), refusing to remove the current admin —
// transfer admin first (POST /api/groups/:id/transfer) so a group is never
// left without one.
export async function removeMember(db: Db, groupId: string, targetMemberId: string): Promise<void> {
  const [target] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.id, targetMemberId), eq(member.groupId, groupId), isNull(member.removedAt)))
    .limit(1);

  if (!target) {
    throw new AppError(404, "Member not found");
  }
  if (target.role === "admin") {
    throw new AppError(400, "Transfer the admin role to someone else before removing this member");
  }

  await db.update(member).set({ removedAt: new Date() }).where(eq(member.id, targetMemberId));
}

// Moves the admin role from `currentAdminMemberId` to `targetMemberId` in
// one statement (a CASE-driven UPDATE across both rows) rather than
// db.transaction(...): the neon-http driver this project swaps in for
// deploy (src/lib/db/client.ts) doesn't support multi-statement
// transactions, so a single atomic UPDATE is the driver-compatible way to
// make sure a group is never left with two admins or zero.
export async function transferAdmin(
  db: Db,
  groupId: string,
  args: { currentAdminMemberId: string; targetMemberId: string }
): Promise<void> {
  const [target] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.id, args.targetMemberId), eq(member.groupId, groupId), isNull(member.removedAt))
    )
    .limit(1);

  if (!target) {
    throw new AppError(404, "Member not found");
  }
  if (target.id === args.currentAdminMemberId) {
    throw new AppError(400, "That member is already the admin");
  }

  await db
    .update(member)
    .set({
      role: sql`case when ${member.id} = ${args.targetMemberId} then 'admin' else 'member' end`,
    })
    .where(and(eq(member.groupId, groupId), sql`${member.id} in (${args.currentAdminMemberId}, ${args.targetMemberId})`));
}
