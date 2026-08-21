// Integration test against the local Postgres, same pattern as
// src/server/seasons/[id]/picks/all.test.ts. Proves getPickReadiness's core
// cases (this session's brief): zero picks -> every question missing, a
// partial slate -> only the unanswered questions, a fully-complete member ->
// "complete" (empty missingQuestions), and a member who joined after some
// questions existed but before lock is still evaluated against the CURRENT
// question set, not a stale one at the time they joined.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, season } from "@/lib/db/schema";
import { createAnonymousUser } from "@/lib/auth/session";
import { joinGroupByCode } from "@/lib/groups/service";
import { createSeason, getQuestions, addQuestion } from "@/lib/seasons/service";
import { upsertPicks, getPickReadiness } from "@/lib/picks/service";
import {
  cleanupSeasonFixtures,
  findActiveMemberId,
  insertTestTeams,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "@/lib/seasons/test-support";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

describe("getPickReadiness", () => {
  it("reports every question missing for a member with zero picks", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [
        { type: "boolean", prompt: "Will it rain?", config: {}, points: 5, settlement: "manual" },
        { type: "numeric", prompt: "How many sixes?", config: {}, points: 5, settlement: "manual" },
      ],
    });

    const readiness = await getPickReadiness(db, created.id, new Date());
    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    const adminEntry = readiness.find((r) => r.memberId === adminMemberId);
    expect(adminEntry?.missingQuestions).toHaveLength(2);
  });

  it("reports only the unanswered questions for a partial slate", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [
        { type: "boolean", prompt: "Will it rain?", config: {}, points: 5, settlement: "manual" },
        { type: "numeric", prompt: "How many sixes?", config: {}, points: 5, settlement: "manual" },
      ],
    });
    const [q1] = await getQuestions(db, created.id);
    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    await upsertPicks(db, created.id, adminMemberId, [{ questionId: q1!.id, answer: { bool: true } }], new Date());

    const readiness = await getPickReadiness(db, created.id, new Date());
    const adminEntry = readiness.find((r) => r.memberId === adminMemberId);
    expect(adminEntry?.missingQuestions).toHaveLength(1);
    expect(adminEntry?.missingQuestions[0]?.prompt).toBe("How many sixes?");
  });

  it("reports 'complete' (empty missingQuestions) for a fully-answered slate", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [{ type: "boolean", prompt: "Will it rain?", config: {}, points: 5, settlement: "manual" }],
    });
    const [q1] = await getQuestions(db, created.id);
    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    await upsertPicks(db, created.id, adminMemberId, [{ questionId: q1!.id, answer: { bool: false } }], new Date());

    const readiness = await getPickReadiness(db, created.id, new Date());
    const adminEntry = readiness.find((r) => r.memberId === adminMemberId);
    expect(adminEntry?.missingQuestions).toHaveLength(0);
  });

  it("evaluates a member who joined after some questions existed against the CURRENT question set", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      questions: [{ type: "boolean", prompt: "Will it rain?", config: {}, points: 5, settlement: "manual" }],
    });

    // A brand-new member joins only after the first question already
    // existed, then a second question is added after that.
    const { userId: latecomerUserId } = await createAnonymousUser(db, "Latecomer");
    createdUserIds.push(latecomerUserId);
    const [groupRow] = await db.select({ joinCode: group.joinCode }).from(group).where(eq(group.id, fixture.groupId));
    await joinGroupByCode(db, { joinCode: groupRow!.joinCode, userId: latecomerUserId });

    await addQuestion(
      db,
      created.id,
      { type: "numeric", prompt: "How many sixes?", config: {}, points: 5, settlement: "manual" },
      new Date()
    );

    const readiness = await getPickReadiness(db, created.id, new Date());
    const latecomerMemberId = await findActiveMemberId(fixture.groupId, latecomerUserId);
    const latecomerEntry = readiness.find((r) => r.memberId === latecomerMemberId);
    // Evaluated against BOTH questions (the current set), not just the one
    // that existed when they joined.
    expect(latecomerEntry?.missingQuestions).toHaveLength(2);
  });

  it("supports team-based questions too", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const teamIds = await insertTestTeams(tournamentId, ["mi"]);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
    });
    const [q1] = await getQuestions(db, created.id);
    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    await upsertPicks(
      db,
      created.id,
      adminMemberId,
      [{ questionId: q1!.id, answer: { teamId: teamIds.mi } }],
      new Date()
    );

    const readiness = await getPickReadiness(db, created.id, new Date());
    const adminEntry = readiness.find((r) => r.memberId === adminMemberId);
    expect(adminEntry?.missingQuestions).toHaveLength(0);
  });
});
