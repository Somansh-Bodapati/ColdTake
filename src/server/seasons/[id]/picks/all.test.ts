// GET /api/seasons/:id/picks/all — doc 03 §3.4's single most important
// security property, stated bluntly in the doc: "/picks/all must return 403
// before lock_at based on a server-side clock comparison... A friend who
// opens the network tab and sees everyone's champion pick destroys the game
// permanently. Write an integration test for this specific case."
//
// Written before api/seasons/[id]/picks/all.ts exists (this session's
// brief, task 1) — this file is red first (the import below fails to
// resolve), then the handler is added to turn it green. The clock is never
// mocked or injected into the route: every assertion here relies on the
// handler's own `new Date()` compared against a real `lock_at` column value
// at request time, exactly like src/lib/seasons/state.ts's lazy-lock
// pattern (api/seasons/[id]/index.test.ts proves the same derivation for
// season status; this proves it gates the picks reveal).

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db/client";
import { group, member, season } from "../../../../lib/db/schema";
import { SESSION_COOKIE_NAME, createAnonymousUser } from "../../../../lib/auth/session";
import { createSeason, getQuestions } from "../../../../lib/seasons/service";
import { joinGroupByCode } from "../../../../lib/groups/service";
import { upsertPicks } from "../../../../lib/picks/service";
import {
  cleanupSeasonFixtures,
  findActiveMemberId,
  insertTestTeams,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../../lib/seasons/test-support";
import handler from "./all";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function allPicksRequest(seasonId: string, rawToken: string | null): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/picks/all`, {
    method: "GET",
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("GET /api/seasons/:id/picks/all", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(allPicksRequest("nonexistent", null));
    expect(response.status).toBe(401);
  });

  it("rejects a non-member with 403 regardless of lock state", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(allPicksRequest(created.id, fixture.outsiderSessionToken));
    expect(response.status).toBe(403);
  });

  // The core property (doc 03 §3.4 / this session's brief task 1): a real
  // *second* member of the group — fixture.memberSessionToken, distinct
  // from the admin who created the season — reading everyone's picks before
  // the real lock_at must be rejected, not just hidden client-side.
  it("rejects a second member reading all picks before lock_at, using the real server clock", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // one real hour from now
      questions: [],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));

    const response = await handler(allPicksRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(403);
  });

  it("allows that same second member to read all picks once real time has passed lock_at", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    // Force it open with a lock_at already in the real past — the route
    // itself must derive "locked" from `new Date()` vs this column at
    // request time (src/lib/seasons/state.ts's effectiveSeasonStatus), with
    // no cron and no injected/mocked clock anywhere in this test file.
    await db
      .update(season)
      .set({ status: "open", lockAt: new Date(Date.now() - 60_000) })
      .where(eq(season.id, created.id));

    const response = await handler(allPicksRequest(created.id, fixture.memberSessionToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { members: unknown[] };
    expect(Array.isArray(body.members)).toBe(true);
  });

  // This session's task 6: member_snapshot is "the definitive record of who
  // was eligible to have picks scored" at lock time — frozen the moment
  // open -> locked happens (src/lib/seasons/service.ts's loadSeason, from
  // Session 7), not re-derived from the live roster on every read. The
  // reveal must reflect that frozen set: someone who joins *after* lock
  // shouldn't appear, and someone who was a member *at* lock still appears
  // even if later removed from the group.
  it("reveals exactly the member_snapshot frozen at lock — not the live roster", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const teamIds = await insertTestTeams(tournamentId, ["mi"]);
    const created = await createSeason(db, {
      groupId: fixture.groupId,
      tournamentId,
      lockAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      questions: [{ type: "champion", prompt: "Who wins?", config: {}, points: 25, settlement: "auto" }],
    });
    await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
    const [questionRow] = await getQuestions(db, created.id);
    if (!questionRow) throw new Error("Fixture setup failed: no question row");

    // The admin submits a pick before lock; the second member never does —
    // doc 01 §2.5 step 4's "no slate" case.
    const adminMemberId = await findActiveMemberId(fixture.groupId, fixture.adminUserId);
    await upsertPicks(
      db,
      created.id,
      adminMemberId,
      [{ questionId: questionRow.id, answer: { teamId: teamIds.mi } }],
      new Date()
    );

    // Force the real lock_at into the past so the *next* read flips
    // open -> locked and freezes member_snapshot (loadSeason's own
    // behavior, not anything special this test does).
    await db
      .update(season)
      .set({ lockAt: new Date(Date.now() - 60_000) })
      .where(eq(season.id, created.id));
    const lockingResponse = await handler(allPicksRequest(created.id, fixture.adminSessionToken));
    expect(lockingResponse.status).toBe(200);

    // A brand-new user joins the group only *after* the season has locked —
    // they must not appear in the reveal.
    const [groupRow] = await db.select().from(group).where(eq(group.id, fixture.groupId));
    if (!groupRow) throw new Error("Fixture setup failed: group not found");
    const { userId: latecomerUserId } = await createAnonymousUser(db, "Latecomer");
    createdUserIds.push(latecomerUserId);
    await joinGroupByCode(db, { joinCode: groupRow.joinCode, userId: latecomerUserId });

    // The original second member (in the snapshot, never picked) is then
    // removed from the group — they must still appear, marked "no slate"
    // via an empty picks array, because they were eligible at lock time.
    const memberMemberId = await findActiveMemberId(fixture.groupId, fixture.memberUserId);
    await db.update(member).set({ removedAt: new Date() }).where(eq(member.id, memberMemberId));

    const response = await handler(allPicksRequest(created.id, fixture.adminSessionToken));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      members: { memberId: string; picks: { answer: { teamId?: string } }[] }[];
    };
    const memberIds = body.members.map((m) => m.memberId);

    expect(memberIds).toContain(adminMemberId);
    expect(memberIds).toContain(memberMemberId); // removed after lock, still in the snapshot
    expect(memberIds).not.toContain(
      (await db.select().from(member).where(eq(member.userId, latecomerUserId)))[0]?.id
    ); // joined after lock, never eligible

    const adminEntry = body.members.find((m) => m.memberId === adminMemberId);
    expect(adminEntry?.picks[0]?.answer.teamId).toBe(teamIds.mi);

    const noSlateEntry = body.members.find((m) => m.memberId === memberMemberId);
    expect(noSlateEntry?.picks).toHaveLength(0); // "no slate" — doc 01 §2.5 step 4
  });
});
