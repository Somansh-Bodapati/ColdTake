// DB-backed settlement logic — doc 01 §2.7 / §4.3, doc 03 §3.6. Three
// pieces, mirroring the style of src/lib/seasons/service.ts and
// src/lib/standings/service.ts:
//
//   - `settleSeason` (POST /settle): "once the tournament's final result is
//     known" (this session's brief, task 1), pulls final table/result/stat
//     leaders straight from the season's StandingsProvider, writes them as
//     immutable `result` rows, and flips the season locked -> settled
//     (src/lib/seasons/state.ts's canSettle). Nothing here special-cases
//     question types: writing those `result` rows is *all* automatic
//     settlement is — champion/runner_up/top_n_*/wooden_spoon/stat_leader/
//     team_over_under all read finalResult/finalTable/statLeaders straight
//     out of the resolvers each already ship (Sessions 2-4); boolean/
//     custom/numeric simply keep resolving `pending` (their resolvers'
//     own doc comments) until `settleQuestion` gives them a fact.
//   - `settleQuestion` (POST /questions/:qid/settle): the manual-settlement
//     UI's write path (task 2) *and* the doc 01 §4.3 admin-override escape
//     hatch (task 3) — the same function, because "override" is just
//     "settle a question that already has a settled value," and the only
//     difference is a required audit note. Every call appends a new
//     `question_result` row (append-only, per schema.ts's doc comment) —
//     never an update-in-place — so the full settle/override history
//     survives even though only the latest row is ever read back.
//   - `voidSeason` (POST /void): doc 01 §4.3's "team withdraws or
//     tournament is abandoned" case — any non-terminal season (state.ts's
//     canVoid) becomes voided, with a required reason. Deliberately never
//     calls recomputeStandings: doc 01 §4.3 is explicit that a voided
//     season "records no scores," and src/lib/standings/service.ts now
//     refuses to compute standings for one anyway.

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import {
  question,
  questionResult,
  result,
  season,
  team,
  type PickAnswer,
  type ResultKind,
  type ResultSource,
} from "../db/schema.js";
import { createId } from "../db/id.js";
import { getTournament, requireSeasonAdmin } from "./service.js";
import { canSettle, canVoid } from "./state.js";
import { recomputeStandings, type StandingsSnapshotRow } from "../standings/service.js";
import { createResolverRegistry } from "../scoring/registry.js";
import { booleanResolver } from "../scoring/resolvers/boolean.js";
import { championResolver } from "../scoring/resolvers/champion.js";
import { customResolver } from "../scoring/resolvers/custom.js";
import { numericResolver } from "../scoring/resolvers/numeric.js";
import { runnerUpResolver } from "../scoring/resolvers/runner-up.js";
import { statLeaderResolver } from "../scoring/resolvers/stat-leader.js";
import { teamOverUnderResolver } from "../scoring/resolvers/team-over-under.js";
import { topNOrderedResolver } from "../scoring/resolvers/top-n-ordered.js";
import { topNUnorderedResolver } from "../scoring/resolvers/top-n-unordered.js";
import { woodenSpoonResolver } from "../scoring/resolvers/wooden-spoon.js";
import type { Question as ScoringQuestion, Tournament } from "../scoring/types.js";
import type { StandingsProvider } from "../providers/types.js";
import { AppError } from "../errors.js";

// Same registry construction as src/lib/picks/service.ts and
// src/lib/scoring/index.ts — reused here for exactly one thing, `validate`,
// so a manually-settled/overridden answer is checked against the identical
// per-type contract a member's own pick already is.
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

export type SeasonRow = typeof season.$inferSelect;
export type QuestionResultRow = typeof questionResult.$inferSelect;

// provider.source is a plain `string` on the StandingsProvider contract
// (types.ts); `result.source` is narrowed to schema.ts's ResultSource.
// Every shipped provider's source ("manual", "cricketdata") is already one
// of that union's values — this just crosses the type boundary the two
// independently-typed fields create, same reasoning as
// src/lib/standings/service.ts's `statusFrom` cast.
function resultSource(source: string): ResultSource {
  return source as ResultSource;
}

async function tournamentTeamIds(db: Db, tournamentId: string): Promise<string[]> {
  const rows = await db.select({ id: team.id }).from(team).where(eq(team.tournamentId, tournamentId));
  return rows.map((row) => row.id);
}

export interface SettleSeasonResult {
  season: SeasonRow;
  snapshot: StandingsSnapshotRow;
  resultKindsWritten: ResultKind[];
}

// POST /api/seasons/:id/settle — doc 03 §3.6 [admin]: "settles auto
// questions from results." Fetches the tournament's final shape straight
// from its StandingsProvider (task 1: "from provider ingestion or admin
// entry" — ManualProvider and CricketDataProvider are both just
// StandingsProvider implementations, so this needs no special-casing
// between them) rather than reusing whatever `live_state` last polled — a
// tournament can finish between ingestion polls, and `result` rows are
// meant to be the immutable final fact, not a copy of the last projected
// one.
export async function settleSeason(
  db: Db,
  seasonId: string,
  provider: StandingsProvider,
  adminUserId: string,
  now: Date
): Promise<SettleSeasonResult> {
  const seasonRow = await requireSeasonAdmin(db, seasonId, adminUserId, now);
  if (!canSettle(seasonRow.status)) {
    throw new AppError(409, `Cannot settle a season in "${seasonRow.status}" status`);
  }

  const tournamentRow = await getTournament(db, seasonRow.tournamentId);
  const statCategories = tournamentRow.config.statCategories ?? [];

  const [tableData, finalResult] = await Promise.all([
    provider.getTable(seasonRow.tournamentId),
    provider.getFinalResult(seasonRow.tournamentId),
  ]);
  const statLeaders: Record<string, { playerId: string; value: number }[]> = {};
  for (const category of statCategories) {
    const entries = await provider.getStatLeaders(seasonRow.tournamentId, category);
    if (entries.length > 0) {
      statLeaders[category] = entries;
    }
  }

  const hasFinalResult = Boolean(finalResult.championTeamId || finalResult.runnerUpTeamId);
  const hasStatLeaders = Object.keys(statLeaders).length > 0;
  if (tableData.length === 0 && !hasFinalResult && !hasStatLeaders) {
    throw new AppError(
      409,
      `Standings provider "${provider.source}" has no final result data yet for this tournament`
    );
  }

  const resultKindsWritten: ResultKind[] = [];
  const rowsToInsert: (typeof result.$inferInsert)[] = [];
  if (tableData.length > 0) {
    rowsToInsert.push({
      id: createId(),
      tournamentId: seasonRow.tournamentId,
      kind: "final_table",
      payload: { rows: tableData.map((row) => ({ teamId: row.teamId, position: row.position })) },
      source: resultSource(provider.source),
      isFinal: true,
      recordedAt: now,
      recordedBy: adminUserId,
    });
    resultKindsWritten.push("final_table");
  }
  if (hasFinalResult) {
    rowsToInsert.push({
      id: createId(),
      tournamentId: seasonRow.tournamentId,
      kind: "final_result",
      payload: { ...finalResult },
      source: resultSource(provider.source),
      isFinal: true,
      recordedAt: now,
      recordedBy: adminUserId,
    });
    resultKindsWritten.push("final_result");
  }
  if (hasStatLeaders) {
    rowsToInsert.push({
      id: createId(),
      tournamentId: seasonRow.tournamentId,
      kind: "stat_leaders",
      payload: statLeaders,
      source: resultSource(provider.source),
      isFinal: true,
      recordedAt: now,
      recordedBy: adminUserId,
    });
    resultKindsWritten.push("stat_leaders");
  }

  await db.insert(result).values(rowsToInsert);

  const [updatedSeason] = await db
    .update(season)
    .set({ status: "settled", settledAt: now })
    .where(eq(season.id, seasonId))
    .returning();
  if (!updatedSeason) {
    throw new AppError(500, "Failed to settle season");
  }

  const snapshot = await recomputeStandings(db, seasonId, now);

  return { season: updatedSeason, snapshot, resultKindsWritten };
}

export interface SettleQuestionResult {
  questionResult: QuestionResultRow;
  snapshot: StandingsSnapshotRow;
}

// POST /api/seasons/:id/questions/:qid/settle — doc 03 §3.6 [admin]: the
// manual settlement UI's write path (task 2, `boolean`/`custom`/`numeric`
// questions with no derivable finalTable/finalResult/statLeaders fact), and
// — when this question already has a settled `question_result` row — the
// doc 01 §4.3 admin-override escape hatch (task 3), which requires `note`
// to be a non-empty audit note. Restricted to a `settled` season (not
// merely `locked`): a season's `result`/`question_result` facts only feed
// `recomputeStandings` in settled mode (buildResultSetFromResults), so
// settling a question before /settle has run would silently have no visible
// effect — this makes that ordering an explicit error instead.
export async function settleQuestion(
  db: Db,
  seasonId: string,
  questionId: string,
  answer: PickAnswer,
  note: string | undefined,
  adminUserId: string,
  now: Date
): Promise<SettleQuestionResult> {
  const seasonRow = await requireSeasonAdmin(db, seasonId, adminUserId, now);
  if (seasonRow.status !== "settled") {
    throw new AppError(
      409,
      "Questions can only be settled once the season itself has been settled (POST .../settle first)"
    );
  }

  const [questionRow] = await db
    .select()
    .from(question)
    .where(and(eq(question.id, questionId), eq(question.seasonId, seasonId)))
    .limit(1);
  if (!questionRow) {
    throw new AppError(404, "Question not found");
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
  const tournament: Tournament = {
    id: seasonRow.tournamentId,
    teamIds: await tournamentTeamIds(db, seasonRow.tournamentId),
  };
  const validation = resolverResult.value.validate(answer, scoringQuestion, tournament);
  if (!validation.ok) {
    throw new AppError(400, validation.error.message);
  }

  const [existing] = await db
    .select({ id: questionResult.id })
    .from(questionResult)
    .where(eq(questionResult.questionId, questionId))
    .orderBy(desc(questionResult.settledAt))
    .limit(1);

  const trimmedNote = note?.trim() || undefined;
  const source = existing ? "override" : "manual";
  if (existing && !trimmedNote) {
    throw new AppError(
      400,
      "An audit note is required when overriding an already-settled question (doc 01 §4.3)"
    );
  }

  const [inserted] = await db
    .insert(questionResult)
    .values({
      id: createId(),
      questionId,
      answer,
      source,
      note: trimmedNote ?? null,
      settledBy: adminUserId,
      settledAt: now,
    })
    .returning();
  if (!inserted) {
    throw new AppError(500, "Failed to settle question");
  }

  const snapshot = await recomputeStandings(db, seasonId, now);

  return { questionResult: inserted, snapshot };
}

// POST /api/seasons/:id/void — doc 03 §3.6 [admin]: doc 01 §4.3's "team
// withdraws or tournament is abandoned" case. `reason` is required — the
// same audit-trail discipline as settleQuestion's override note — since
// voiding is otherwise a silent, unexplained "no scores recorded" for every
// member in the season.
export async function voidSeason(
  db: Db,
  seasonId: string,
  reason: string,
  adminUserId: string,
  now: Date
): Promise<SeasonRow> {
  const seasonRow = await requireSeasonAdmin(db, seasonId, adminUserId, now);
  if (!canVoid(seasonRow.status)) {
    throw new AppError(409, `Cannot void a season in "${seasonRow.status}" status`);
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new AppError(400, "A reason is required to void a season");
  }

  const [updated] = await db
    .update(season)
    .set({ status: "voided", voidedAt: now, voidReason: trimmedReason, voidedBy: adminUserId })
    .where(eq(season.id, seasonId))
    .returning();
  if (!updated) {
    throw new AppError(500, "Failed to void season");
  }
  return updated;
}
