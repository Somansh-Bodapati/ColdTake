// Assembles the scoring engine's `ResultSet` (src/lib/scoring/types.ts) from
// this tournament's `result` rows (settled) or its `live_state` row
// (mid-season) — doc 03 §2.5: "results is derived from live_state rather
// than result [...] the shape and the engine's logic are identical either
// way." This module is the caller-side half of that contract; the engine
// itself never touches either table (CLAUDE.md rule 1).
//
// Neither table has a prior write path in this codebase yet — ingestion
// (doc 03 §4.2/session 11) and settlement (session 12) haven't shipped —
// so the exact JSON shape `result.payload` carries per `kind` is this
// session's own decision, made to match the scoring engine's existing
// structural types 1:1 rather than inventing a new intermediate shape:
//   - kind 'final_table'  -> payload: { rows: FinalTableRow[] }
//   - kind 'final_result' -> payload: FinalResult (championTeamId?,
//                             runnerUpTeamId?), stored directly
//   - kind 'stat_leaders' -> payload: Record<string, StatLeaderEntry[]>,
//                             stored directly
// A later ingestion session is free to change how these rows get written,
// as long as it keeps writing this shape — or updates this module to match.

import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/auth/session";
import { liveState, result } from "@/lib/db/schema";
import type {
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

// Settled mode (season status 'settled'): builds the ResultSet from the
// most recent `is_final` row of each kind. `questionResults` (the
// admin-manual-settlement facts for boolean/custom/numeric) is left
// undefined here — that's session 12's write path, out of this session's
// scope; those question types simply resolve `pending` until it exists,
// exactly like doc 03 §2.5's projected-mode "cannot be projected" case.
export async function buildResultSetFromResults(
  db: Db,
  tournamentId: string
): Promise<ResultSet> {
  const rows = await db
    .select()
    .from(result)
    .where(eq(result.tournamentId, tournamentId))
    .orderBy(desc(result.recordedAt));

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
