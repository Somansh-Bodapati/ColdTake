// Shared fixture builders for api/seasons/* and api/tournaments/* integration
// tests — same "hit the real local Postgres" pattern as
// api/groups/[id]/transfer.test.ts, just factored out once instead of
// re-typed in every season test file, since every one of them needs the same
// admin+member+tournament trio. Not a barrel file (CLAUDE.md: no index.ts
// re-exports) — these are the fixtures themselves, not re-exports of them.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, member, tournament, user } from "@/lib/db/schema";
import { createAnonymousUser } from "@/lib/auth/session";
import { createGroup, joinGroupByCode } from "@/lib/groups/service";
import { createId } from "@/lib/db/id";

export interface GroupFixture {
  groupId: string;
  adminUserId: string;
  adminSessionToken: string;
  memberUserId: string;
  memberSessionToken: string;
  outsiderSessionToken: string;
}

export async function makeGroupWithAdminAndMember(
  createdUserIds: string[],
  createdGroupIds: string[]
): Promise<GroupFixture> {
  const { userId: adminUserId, session: adminSession } = await createAnonymousUser(db, "Admin");
  createdUserIds.push(adminUserId);
  const created = await createGroup(db, { name: "Season Test Group", creatorUserId: adminUserId });
  createdGroupIds.push(created.id);

  const { userId: memberUserId, session: memberSession } = await createAnonymousUser(db, "Member");
  createdUserIds.push(memberUserId);
  await joinGroupByCode(db, { joinCode: created.joinCode, userId: memberUserId });

  const { userId: outsiderUserId, session: outsiderSession } = await createAnonymousUser(db, "Outsider");
  createdUserIds.push(outsiderUserId);

  return {
    groupId: created.id,
    adminUserId,
    adminSessionToken: adminSession.rawToken,
    memberUserId,
    memberSessionToken: memberSession.rawToken,
    outsiderSessionToken: outsiderSession.rawToken,
  };
}

// Minimal tournament catalogue row — tests insert/delete this directly
// (no service.createTournament exists; the catalogue is system-seeded, doc
// 03 §1.3) rather than depending on seed/tournament.json's fixed ids, so
// each test run gets an isolated, disposable tournament row.
export async function insertTestTournament(
  createdTournamentIds: string[],
  overrides: { startsAt?: Date; statCategories?: string[] } = {}
): Promise<string> {
  const id = `test-tournament-${createId()}`;
  await db.insert(tournament).values({
    id,
    sport: "cricket",
    name: "Test Tournament",
    shortName: "TT 2026",
    startsAt: overrides.startsAt ?? new Date("2026-03-20T14:00:00.000Z"),
    endsAt: null,
    status: "upcoming",
    teamCount: 8,
    providerKey: null,
    config: { statCategories: overrides.statCategories ?? ["runs", "wickets", "sixes"] },
  });
  createdTournamentIds.push(id);
  return id;
}

export async function cleanupSeasonFixtures(
  createdGroupIds: string[],
  createdUserIds: string[],
  createdTournamentIds: string[]
): Promise<void> {
  if (createdGroupIds.length > 0) {
    await db.delete(group).where(inArray(group.id, createdGroupIds));
    createdGroupIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
  if (createdTournamentIds.length > 0) {
    await db.delete(tournament).where(inArray(tournament.id, createdTournamentIds));
    createdTournamentIds.length = 0;
  }
}

export async function findActiveMemberId(groupId: string, userId: string): Promise<string> {
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.groupId, groupId), eq(member.userId, userId), isNull(member.removedAt)));
  if (!row) {
    throw new Error("Fixture setup failed: member row not found");
  }
  return row.id;
}
