// DB-backed season/question logic: tournament catalogue, season creation,
// the lazy lock-state sync, question add/remove, and publish. Mirrors the
// style of src/lib/groups/service.ts — the queries plus the small amount of
// business logic around them, imported directly by api/seasons/* and
// api/tournaments/*.

import { asc, and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import { member, question, season, team, tournament, type SeasonStatus } from "../db/schema.js";
import { createId } from "../db/id.js";
import { requireAdmin, requireMembership } from "../groups/service.js";
import { canPublish, effectiveSeasonStatus, isMutableStatus } from "./state.js";
import { AppError } from "../errors.js";
import type { QuestionInput } from "../schemas/seasons.js";

// Mirrors src/lib/groups/service.ts's isUniqueViolation, but also checks
// `.cause`: drizzle-orm's node-postgres driver wraps the raw pg error (which
// carries `.code`/`.constraint`) in a DrizzleQueryError, so the fields this
// needs live one level down from what gets thrown/caught here.
function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidates = [error, error instanceof Error ? error.cause : undefined];
  return candidates.some(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "code" in candidate &&
      (candidate as { code?: unknown }).code === "23505" &&
      "constraint" in candidate &&
      (candidate as { constraint?: unknown }).constraint === constraint
  );
}

export async function getTournamentCatalogue(db: Db) {
  return db.select().from(tournament).orderBy(asc(tournament.startsAt));
}

export async function getTournament(db: Db, tournamentId: string) {
  const [row] = await db.select().from(tournament).where(eq(tournament.id, tournamentId)).limit(1);
  if (!row) {
    throw new AppError(404, "Tournament not found");
  }
  return row;
}

// Every route that touches a season must load it through here (this
// session's brief, task 1): the stored `status` column is only ever an
// admin-written value (draft/open set by publish, settled/voided by a later
// session's settle/void endpoints). The open -> locked edge is time-driven
// (doc 03 §4), so this recomputes the *effective* status from `lock_at` on
// every call and, if it has just flipped, persists that — a write
// triggered by this read/write, never by a scheduled job (CLAUDE.md rule 3).
export async function loadSeason(db: Db, seasonId: string, now: Date) {
  const [row] = await db.select().from(season).where(eq(season.id, seasonId)).limit(1);
  if (!row) {
    throw new AppError(404, "Season not found");
  }

  const effective = effectiveSeasonStatus(row.status, row.lockAt, now);
  if (effective === row.status) {
    return row;
  }

  // open -> locked just became true. Persist it (doc 03 §4: "At lock: write
  // member_snapshot") so standings/boldness reads later don't have to
  // re-derive it, but the *correctness* of "picks are locked" never depended
  // on this write having already happened — effectiveSeasonStatus is what
  // every caller actually trusts.
  const [updated] = await db
    .update(season)
    .set({ status: "locked", memberSnapshot: row.memberSnapshot ?? (await activeMemberIds(db, row.groupId)) })
    .where(eq(season.id, seasonId))
    .returning();
  return updated ?? { ...row, status: effective };
}

// Exported for src/lib/standings/service.ts: a recompute triggered before
// lock (season still `open`, no member_snapshot frozen yet) needs the same
// "who's actually in the group right now" set loadSeason itself falls back
// to when it freezes the snapshot at lock.
export async function activeMemberIds(db: Db, groupId: string): Promise<string[]> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.groupId, groupId), isNull(member.removedAt)));
  return rows.map((row) => row.id);
}

export async function requireSeasonMembership(db: Db, seasonId: string, userId: string, now: Date) {
  const seasonRow = await loadSeason(db, seasonId, now);
  await requireMembership(db, seasonRow.groupId, userId);
  return seasonRow;
}

export async function requireSeasonAdmin(db: Db, seasonId: string, userId: string, now: Date) {
  const seasonRow = await loadSeason(db, seasonId, now);
  await requireAdmin(db, seasonRow.groupId, userId);
  return seasonRow;
}

function requireMutable(seasonRow: { status: SeasonStatus }): void {
  if (!isMutableStatus(seasonRow.status)) {
    throw new AppError(409, "Season questions and settings can only change while draft or open");
  }
}

export interface CreateSeasonArgs {
  groupId: string;
  tournamentId: string;
  lockAt?: string;
  scoringConfig?: { boldPickEnabled: boolean; injuryRule: "zero" | "void" };
  questions: QuestionInput[];
}

// POST /api/seasons — doc 03 §3.3. Caller (the route) has already verified
// group-admin. Creates the season in 'draft' plus any templates/custom
// questions the admin already picked in the creation flow (doc 01 §2.3
// steps 1-3 happen client-side against buildDefaultQuestionTemplates before
// this call; this just persists the result).
export async function createSeason(db: Db, args: CreateSeasonArgs) {
  const tournamentRow = await getTournament(db, args.tournamentId);

  const lockAt = args.lockAt ? new Date(args.lockAt) : tournamentRow.startsAt;
  const scoringConfig = args.scoringConfig ?? { boldPickEnabled: true, injuryRule: "zero" as const };

  let seasonRow;
  try {
    [seasonRow] = await db
      .insert(season)
      .values({
        id: createId(),
        groupId: args.groupId,
        tournamentId: args.tournamentId,
        name: tournamentRow.shortName,
        lockAt,
        status: "draft",
        scoringConfig,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error, "season_group_id_tournament_id_unique")) {
      throw new AppError(409, "This group already has a season for that tournament");
    }
    throw error;
  }
  if (!seasonRow) {
    throw new AppError(500, "Failed to create season");
  }

  if (args.questions.length > 0) {
    await db.insert(question).values(
      args.questions.map((input, index) => ({
        id: createId(),
        seasonId: seasonRow.id,
        type: input.type,
        prompt: input.prompt,
        config: input.config,
        points: input.points,
        sortOrder: index + 1,
        settlement: input.settlement,
      }))
    );
  }

  return seasonRow;
}

// This session's bug fix: the pick sheet's team-based questions (champion,
// runner_up, wooden_spoon, top_n_*) need a real catalogue of the season's
// tournament's teams to build a dropdown from, sorted alphabetically by
// name (this session's brief, task 5) for usability.
export async function getSeasonTeams(db: Db, tournamentId: string) {
  return db
    .select({ id: team.id, name: team.name, shortName: team.shortName })
    .from(team)
    .where(eq(team.tournamentId, tournamentId))
    .orderBy(asc(team.name));
}

export async function getQuestions(db: Db, seasonId: string) {
  return db.select().from(question).where(eq(question.seasonId, seasonId)).orderBy(asc(question.sortOrder));
}

// Group-scoped season list — this hardening session's fix: before this,
// nothing in the API surface let a member discover a group's existing
// seasons at all (GET /api/groups/:id never returned them and there was no
// other listing route), so the group page had no way to link into a
// season, show "no seasons yet," or let a member who joined later find
// their slate. Caller (api/groups/[id]/index.ts) has already verified group
// membership. Uses effectiveSeasonStatus (not the raw stored column) so a
// season whose lock_at has passed but hasn't been read/written since shows
// as "locked" here too — same lazy-lock discipline as loadSeason.
export async function listSeasonsByGroup(db: Db, groupId: string, now: Date) {
  const rows = await db
    .select()
    .from(season)
    .where(eq(season.groupId, groupId))
    .orderBy(desc(season.createdAt));
  return rows.map((row) => ({
    ...row,
    status: effectiveSeasonStatus(row.status, row.lockAt, now),
  }));
}

export interface UpdateSeasonArgs {
  lockAt?: string;
  scoringConfig?: { boldPickEnabled: boolean; injuryRule: "zero" | "void" };
}

// PATCH /api/seasons/:id — doc 03 §3.3 [admin, only while draft/open].
export async function updateSeason(db: Db, seasonId: string, args: UpdateSeasonArgs, now: Date) {
  const seasonRow = await loadSeason(db, seasonId, now);
  requireMutable(seasonRow);

  const patch: Partial<typeof season.$inferInsert> = {};
  if (args.lockAt !== undefined) {
    patch.lockAt = new Date(args.lockAt);
  }
  if (args.scoringConfig !== undefined) {
    patch.scoringConfig = args.scoringConfig;
  }
  if (Object.keys(patch).length === 0) {
    return seasonRow;
  }

  const [updated] = await db.update(season).set(patch).where(eq(season.id, seasonId)).returning();
  if (!updated) {
    throw new AppError(404, "Season not found");
  }
  return updated;
}

// POST /api/seasons/:id/publish — doc 03 §3.3 [admin]. draft -> open, doc 03
// §4's transition rule: requires >= 1 question and a lock_at in the future.
export async function publishSeason(db: Db, seasonId: string, now: Date) {
  const seasonRow = await loadSeason(db, seasonId, now);
  if (seasonRow.status !== "draft") {
    throw new AppError(409, `Cannot publish a season in "${seasonRow.status}" status`);
  }

  const questionRows = await getQuestions(db, seasonId);
  if (!canPublish({ questionCount: questionRows.length, lockAt: seasonRow.lockAt, now })) {
    throw new AppError(
      400,
      "A season needs at least one question and a lock time in the future to publish"
    );
  }

  const [updated] = await db
    .update(season)
    .set({ status: "open" })
    .where(eq(season.id, seasonId))
    .returning();
  if (!updated) {
    throw new AppError(404, "Season not found");
  }
  return updated;
}

// POST /api/seasons/:id/questions — doc 03 §3.3 [admin, only while
// draft/open]. Structurally the same insert whether `input.type` is one of
// the templates or 'custom' (the custom question builder, this session's
// brief task 4) — a `question` row with `type: "custom"`, config validated
// by questionInputSchema's customConfigSchema against exactly what
// src/lib/scoring/resolvers/custom.ts expects.
export async function addQuestion(db: Db, seasonId: string, input: QuestionInput, now: Date) {
  const seasonRow = await loadSeason(db, seasonId, now);
  requireMutable(seasonRow);

  const [{ maxSortOrder }] = await db
    .select({ maxSortOrder: sql<number>`coalesce(max(${question.sortOrder}), 0)` })
    .from(question)
    .where(eq(question.seasonId, seasonId));

  const [inserted] = await db
    .insert(question)
    .values({
      id: createId(),
      seasonId,
      type: input.type,
      prompt: input.prompt,
      config: input.config,
      points: input.points,
      sortOrder: maxSortOrder + 1,
      settlement: input.settlement,
    })
    .returning();
  if (!inserted) {
    throw new AppError(500, "Failed to add question");
  }
  return inserted;
}

// DELETE /api/seasons/:id/questions/:qid — doc 03 §3.3 [admin, only while
// draft/open].
export async function deleteQuestion(db: Db, seasonId: string, questionId: string, now: Date) {
  const seasonRow = await loadSeason(db, seasonId, now);
  requireMutable(seasonRow);

  const [deleted] = await db
    .delete(question)
    .where(and(eq(question.id, questionId), eq(question.seasonId, seasonId)))
    .returning();
  if (!deleted) {
    throw new AppError(404, "Question not found");
  }
}
