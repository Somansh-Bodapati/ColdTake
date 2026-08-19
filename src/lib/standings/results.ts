// Assembles the scoring engine's `ResultSet` (src/lib/scoring/types.ts) from
// this tournament's `result` rows (settled) or its `live_state` row
// (mid-season) — doc 03 §2.5: "results is derived from live_state rather
// than result [...] the shape and the engine's logic are identical either
// way." This module is the caller-side half of that contract; the engine
// itself never touches either table (CLAUDE.md rule 1).
//
// Neither table had a prior write path before Session 11/12 shipped
// ingestion/settlement — so the exact JSON shape `result.payload` carries
// per `kind` was this session's own decision, made to match the scoring
// engine's existing structural types 1:1 rather than inventing a new
// intermediate shape:
//   - kind 'final_table'  -> payload: { rows: FinalTableRow[] }
//   - kind 'final_result' -> payload: FinalResult (championTeamId?,
//                             runnerUpTeamId?), stored directly
//   - kind 'stat_leaders' -> payload: Record<string, StatLeaderEntry[]>,
//                             stored directly
// Session 12 (settlement) is the module that actually writes `result` rows
// (src/lib/seasons/settlement.ts) and, separately, `question_result` rows
// for the `boolean`/`custom`/`numeric` types and any admin override — this
// module reads both back into one `ResultSet.questionResults`, keyed by
// questionId (types.ts's own doc comment on that field).

import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/auth/session";
import { liveState, question, questionResult, result, type PickAnswer } from "@/lib/db/schema";
import type {
  Answer,
  FinalResult,
  FinalTableRow,
  ResultSet,
  StatLeaderEntry,
} from "@/lib/scoring/types";

function isFinalTableRow(value: unknown): value is FinalTableRow {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { teamId?: unknown }).teamId === "string" &&
    typeof (value as { position?: unknown }).position === "number"
  );
}

function readFinalTablePayload(payload: Record<string, unknown>): FinalTableRow[] | undefined {
  const rows = payload.rows;
  if (!Array.isArray(rows)) {
    return undefined;
  }
  const parsed = rows.filter(isFinalTableRow);
  return parsed.length > 0 ? parsed : undefined;
}

function readFinalResultPayload(payload: Record<string, unknown>): FinalResult | undefined {
  const championTeamId = payload.championTeamId;
  const runnerUpTeamId = payload.runnerUpTeamId;
  const out: FinalResult = {};
  if (typeof championTeamId === "string") out.championTeamId = championTeamId;
  if (typeof runnerUpTeamId === "string") out.runnerUpTeamId = runnerUpTeamId;
  return out.championTeamId || out.runnerUpTeamId ? out : undefined;
}

function isStatLeaderEntry(value: unknown): value is StatLeaderEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { playerId?: unknown }).playerId === "string" &&
    typeof (value as { value?: unknown }).value === "number"
  );
}

function readStatLeadersPayload(
  payload: Record<string, unknown>
): Record<string, StatLeaderEntry[]> | undefined {
  const out: Record<string, StatLeaderEntry[]> = {};
  for (const [category, entries] of Object.entries(payload)) {
    if (Array.isArray(entries)) {
      out[category] = entries.filter(isStatLeaderEntry);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Latest (by settledAt) question_result row per questionId among this
// season's questions — the "current value" of an append-only table, same
// pattern `result` itself uses (latest is_final row per kind) and
// pick_history's "history, current value is just the newest row" model.
// An admin override simply inserts a newer row; nothing here ever needs to
// know a question was overridden versus settled once, only what the value
// is *now*.
async function loadQuestionResults(
  db: Db,
  seasonId: string
): Promise<Record<string, Answer> | undefined> {
  const questionRows = await db
    .select({ id: question.id })
    .from(question)
    .where(eq(question.seasonId, seasonId));
  const questionIds = questionRows.map((row) => row.id);
  if (questionIds.length === 0) {
    return undefined;
  }

  const rows = await db
    .select()
    .from(questionResult)
    .where(inArray(questionResult.questionId, questionIds))
    .orderBy(desc(questionResult.settledAt));

  const out: Record<string, PickAnswer> = {};
  for (const row of rows) {
    if (!(row.questionId in out)) {
      out[row.questionId] = row.answer;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Settled mode (season status 'settled'): builds the ResultSet from the
// most recent `is_final` row of each kind, plus (session 12) this season's
// manually-settled/overridden `question_result` facts for `boolean`/
// `custom`/`numeric` — those types simply resolve `pending` until a
// settlement row exists, exactly like doc 03 §2.5's projected-mode "cannot
// be projected" case.
export async function buildResultSetFromResults(
  db: Db,
  tournamentId: string,
  seasonId: string
): Promise<ResultSet> {
  const [rows, questionResults] = await Promise.all([
    db
      .select()
      .from(result)
      .where(eq(result.tournamentId, tournamentId))
      .orderBy(desc(result.recordedAt)),
    loadQuestionResults(db, seasonId),
  ]);

  const out: ResultSet = {};
  for (const row of rows) {
    if (!row.isFinal) continue;
    if (row.kind === "final_table" && out.finalTable === undefined) {
      out.finalTable = readFinalTablePayload(row.payload);
    } else if (row.kind === "final_result" && out.finalResult === undefined) {
      out.finalResult = readFinalResultPayload(row.payload);
    } else if (row.kind === "stat_leaders" && out.statLeaders === undefined) {
      out.statLeaders = readStatLeadersPayload(row.payload);
    }
  }
  if (questionResults) {
    out.questionResults = questionResults;
  }
  return out;
}

// Projected mode (season status 'open'/'locked', not yet settled): current
// league table and stat leaders substitute for the final ones (doc 03
// §2.5). No `finalResult` is derivable from live_state at all — there's no
// "current champion" mid-season — so champion/runner_up naturally resolve
// `pending`, exactly as the doc's example describes.
export async function buildResultSetFromLiveState(
  db: Db,
  tournamentId: string
): Promise<ResultSet> {
  const [row] = await db
    .select()
    .from(liveState)
    .where(eq(liveState.tournamentId, tournamentId))
    .limit(1);
  if (!row) {
    return {};
  }

  const finalTable: FinalTableRow[] = row.tableData.map((entry) => ({
    teamId: entry.teamId,
    position: entry.position,
  }));

  const statLeaders: Record<string, StatLeaderEntry[]> = {};
  for (const [category, entries] of Object.entries(row.statLeaders)) {
    if (entries) {
      statLeaders[category] = entries.map((entry) => ({
        playerId: entry.playerId,
        value: entry.value,
      }));
    }
  }

  return {
    finalTable: finalTable.length > 0 ? finalTable : undefined,
    statLeaders: Object.keys(statLeaders).length > 0 ? statLeaders : undefined,
  };
}
