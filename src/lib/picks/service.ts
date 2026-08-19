// DB-backed pick logic: membership resolution, per-type validated upsert
// (append-only into pick_history on every change), "my picks", and the
// lock-gated "everyone's picks" reveal. Mirrors the style of
// src/lib/seasons/service.ts and src/lib/groups/service.ts.

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/auth/session";
import { member, pick, pickHistory, team, user, type PickAnswer } from "@/lib/db/schema";
import { createId } from "@/lib/db/id";
import { requireMembership } from "@/lib/groups/service";
import { loadSeason, getQuestions } from "@/lib/seasons/service";
import { isPickWindowOpen } from "@/lib/seasons/state";
import { createResolverRegistry } from "@/lib/scoring/registry";
import { booleanResolver } from "@/lib/scoring/resolvers/boolean";
import { championResolver } from "@/lib/scoring/resolvers/champion";
import { customResolver } from "@/lib/scoring/resolvers/custom";
import { numericResolver } from "@/lib/scoring/resolvers/numeric";
import { runnerUpResolver } from "@/lib/scoring/resolvers/runner-up";
import { statLeaderResolver } from "@/lib/scoring/resolvers/stat-leader";
import { teamOverUnderResolver } from "@/lib/scoring/resolvers/team-over-under";
import { topNOrderedResolver } from "@/lib/scoring/resolvers/top-n-ordered";
import { topNUnorderedResolver } from "@/lib/scoring/resolvers/top-n-unordered";
import { woodenSpoonResolver } from "@/lib/scoring/resolvers/wooden-spoon";
import type { Question as ScoringQuestion, Tournament } from "@/lib/scoring/types";
import type { PickInput } from "@/lib/schemas/picks";
import { AppError } from "@/lib/errors";

// Same registry construction as src/lib/scoring/index.ts (that module
// doesn't export its instance — it's the engine's own orchestrator, not a
// shared utility), reused here for exactly one thing: `validate`. This is
// task 2 of this session's brief, "reuse Zod schemas keyed by question
// type... validate against exactly what that question's resolver expects" —
// the resolver *is* that per-type validator, already written and already
// tested in src/lib/scoring/resolvers/*.test.ts, so calling straight into it
// is the most literal way to guarantee a stored pick is structurally exactly
// what the Session 2-4 scoring engine will later consume.
const resolverRegistry = createResolverRegistry([
  championResolver,
  runnerUpResolver,
  topNUnorderedResolver,
  topNOrderedResolver,
  woodenSpoonResolver,
  statLeaderResolver,
  teamOverUnderResolver,
  numericResolver,
  booleanResolver,
  customResolver,
]);

// Every picks endpoint must verify group membership (this session's brief,
// task 7 — same discipline as Sessions 6-7) and needs the caller's own
// `member.id` to scope reads/writes to. loadSeason first (so a bad seasonId
// 404s before anything else), then requireMembership against its groupId —
// same order api/seasons/[id]/* already establishes.
export async function requireSeasonMember(
  db: Db,
  seasonId: string,
  userId: string,
  now: Date
): Promise<{ seasonRow: Awaited<ReturnType<typeof loadSeason>>; memberId: string }> {
  const seasonRow = await loadSeason(db, seasonId, now);
  const membership = await requireMembership(db, seasonRow.groupId, userId);
  return { seasonRow, memberId: membership.memberId };
}

async function tournamentTeamIds(db: Db, tournamentId: string): Promise<string[]> {
  const rows = await db.select({ id: team.id }).from(team).where(eq(team.tournamentId, tournamentId));
  return rows.map((row) => row.id);
}

export type PickRow = typeof pick.$inferSelect;

// GET /api/seasons/:id/picks/mine — doc 03 §3.4: "own picks only." No
// lock-state gating: a member can always see their own picks, before or
// after lock (doc 01 §2.4 step 5 draws the privacy line at *other*
// members' picks, not the caller's own).
export async function getMyPicks(db: Db, seasonId: string, memberId: string): Promise<PickRow[]> {
  const questionRows = await getQuestions(db, seasonId);
  const questionIds = questionRows.map((row) => row.id);
  if (questionIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(pick)
    .where(and(inArray(pick.questionId, questionIds), eq(pick.memberId, memberId)));
}

export interface MemberPicksRow {
  memberId: string;
  userId: string;
  displayName: string;
  picks: PickRow[];
}

// GET /api/seasons/:id/picks/all — doc 03 §3.4: "403 before lock, full
// reveal after." The 403 half is enforced by the caller (the route) via
// isRevealed(seasonRow.status) *before* this ever runs — this function only
// ever executes once that's already true, so it isn't itself the security
// boundary, but it still scopes to member_snapshot (doc 03 §4: "At lock:
// write member_snapshot") rather than the live roster, which is this
// session's task 6: member_snapshot is "the definitive record of who was
// eligible to have picks scored" at lock time, so the reveal shows exactly
// that set — not members who joined after lock, and still including members
// later removed from the group.
export async function getAllPicks(
  db: Db,
  seasonId: string,
  memberSnapshot: readonly string[]
): Promise<MemberPicksRow[]> {
  if (memberSnapshot.length === 0) {
    return [];
  }

  const [questionRows, memberRows] = await Promise.all([
    getQuestions(db, seasonId),
    db
      .select({ id: member.id, userId: member.userId, displayName: user.displayName })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(inArray(member.id, [...memberSnapshot])),
  ]);

  const questionIds = questionRows.map((row) => row.id);
  const pickRows =
    questionIds.length > 0
      ? await db
          .select()
          .from(pick)
          .where(and(inArray(pick.questionId, questionIds), inArray(pick.memberId, [...memberSnapshot])))
      : [];

  const picksByMember = new Map<string, PickRow[]>();
  for (const row of pickRows) {
    const existing = picksByMember.get(row.memberId);
    if (existing) {
      existing.push(row);
    } else {
      picksByMember.set(row.memberId, [row]);
    }
  }

  return memberRows.map((row) => ({
    memberId: row.id,
    userId: row.userId,
    displayName: row.displayName,
    // doc 01 §2.5 step 4: a member who never submitted anything is "marked
    // 'no slate'" — represented here as simply an empty picks array; the UI
    // renders that state rather than the API inventing a separate flag.
    picks: picksByMember.get(row.id) ?? [],
  }));
}

// PUT /api/seasons/:id/picks — doc 03 §3.4: { picks: [{questionId, answer}]
// } → upsert, rejected after lock. This session's brief, tasks 2-3:
// per-question-type validation via the resolver registry above, and an
// append-only src/lib/db/schema.ts `pick_history` row for every change —
// never an update/delete of history (doc 03 §5 checklist's last line).
export async function upsertPicks(
  db: Db,
  seasonId: string,
  memberId: string,
  inputs: readonly PickInput[],
  now: Date
): Promise<PickRow[]> {
  const seasonRow = await loadSeason(db, seasonId, now);
  if (!isPickWindowOpen(seasonRow.status)) {
    throw new AppError(409, "Picks can only be submitted while the season is open");
  }

  const questionRows = await getQuestions(db, seasonId);
  const questionsById = new Map(questionRows.map((row) => [row.id, row]));
  const tournament: Tournament = {
    id: seasonRow.tournamentId,
    teamIds: await tournamentTeamIds(db, seasonRow.tournamentId),
  };

  // Validate every pick in the batch up front, before writing any of them —
  // a partially-invalid PUT should change nothing, not silently save the
  // valid prefix.
  const validated: { questionRow: (typeof questionRows)[number]; answer: PickAnswer }[] = [];
  for (const input of inputs) {
    const questionRow = questionsById.get(input.questionId);
    if (!questionRow) {
      throw new AppError(400, `Question "${input.questionId}" is not part of this season's slate`);
    }
    const resolverResult = resolverRegistry.get(questionRow.type);
    if (!resolverResult.ok) {
      throw new AppError(500, resolverResult.error.message);
    }
    const scoringQuestion: ScoringQuestion = {
      id: questionRow.id,
      type: questionRow.type,
      config: questionRow.config,
      points: questionRow.points,
    };
    const validation = resolverResult.value.validate(input.answer, scoringQuestion, tournament);
    if (!validation.ok) {
      throw new AppError(400, validation.error.message);
    }
    validated.push({ questionRow, answer: input.answer });
  }

  return db.transaction(async (tx) => {
    const saved: PickRow[] = [];
    for (const { questionRow, answer } of validated) {
      const [row] = await tx
        .insert(pick)
        .values({ id: createId(), questionId: questionRow.id, memberId, answer, submittedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [pick.questionId, pick.memberId],
          set: { answer, updatedAt: now },
        })
        .returning();
      if (!row) {
        throw new AppError(500, "Failed to save pick");
      }
      // Append-only audit trail (doc 03 §1.4 / §5 checklist) — one row per
      // change, including the first (creation is itself a "change" from no
      // pick to a pick). Never updated or deleted anywhere in this codebase.
      await tx.insert(pickHistory).values({ pickId: row.id, answer, recordedAt: now });
      saved.push(row);
    }
    return saved;
  });
}
