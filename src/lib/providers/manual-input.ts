// Write path behind the admin manual-entry form (doc 03 §3.6: POST
// /api/admin/manual-standings/:tournamentId). Deliberately separate from
// ManualProvider (manual-provider.ts), which only ever reads: this is the
// one place manual_standings_input gets written, keeping the
// StandingsProvider interface itself (and every other provider that will
// eventually implement it) read-only.

import { eq } from "drizzle-orm";
import type { Db } from "@/lib/auth/session";
import {
  manualStandingsInput,
  type LiveStateStatLeaders,
  type LiveStateTableRow,
  type ManualFinalResult,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";

export interface SaveManualStandingsArgs {
  tournamentId: string;
  tableData: LiveStateTableRow[];
  statLeaders: LiveStateStatLeaders;
  finalResult?: ManualFinalResult;
  updatedBy: string;
}

// Upserts the single admin-edited row for this tournament — one row per
// tournament, same "overwritten on each save" model as live_state itself
// (schema.ts's own comment on that table), so re-submitting the same form
// twice never creates a duplicate row.
export async function saveManualStandings(db: Db, args: SaveManualStandingsArgs, now: Date) {
  const [row] = await db
    .insert(manualStandingsInput)
    .values({
      tournamentId: args.tournamentId,
      tableData: args.tableData,
      statLeaders: args.statLeaders,
      finalResult: args.finalResult ?? null,
      updatedAt: now,
      updatedBy: args.updatedBy,
    })
    .onConflictDoUpdate({
      target: manualStandingsInput.tournamentId,
      set: {
        tableData: args.tableData,
        statLeaders: args.statLeaders,
        finalResult: args.finalResult ?? null,
        updatedAt: now,
        updatedBy: args.updatedBy,
      },
    })
    .returning();
  if (!row) {
    throw new AppError(500, "Failed to save manual standings input");
  }
  return row;
}

export async function getManualStandingsInput(db: Db, tournamentId: string) {
  const [row] = await db
    .select()
    .from(manualStandingsInput)
    .where(eq(manualStandingsInput.tournamentId, tournamentId))
    .limit(1);
  return row;
}
