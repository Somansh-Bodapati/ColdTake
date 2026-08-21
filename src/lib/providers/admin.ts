// Authorization for POST /api/admin/manual-standings/:tournamentId (doc 03
// §3.6: "[group admin or system admin]"). No system-admin role exists
// anywhere in this schema (Session 1 never added one, and no later session
// brief before this one introduces it), so this resolves the doc's "system
// admin" half as: an admin of *any* group currently running a season on
// this tournament. A tournament with no seasons yet has no possible admin to
// check against, so it 404s rather than letting the first authenticated
// caller in.

import { eq } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import { season } from "../db/schema.js";
import { requireAdmin } from "../groups/service.js";
import { AppError } from "../errors.js";

export async function requireTournamentAdmin(db: Db, tournamentId: string, userId: string): Promise<void> {
  const seasonRows = await db
    .select({ groupId: season.groupId })
    .from(season)
    .where(eq(season.tournamentId, tournamentId));

  if (seasonRows.length === 0) {
    throw new AppError(404, "No season is tracking this tournament yet");
  }

  for (const row of seasonRows) {
    try {
      await requireAdmin(db, row.groupId, userId);
      return;
    } catch (error) {
      if (error instanceof AppError && (error.status === 403 || error.status === 404)) {
        continue;
      }
      throw error;
    }
  }

  throw new AppError(403, "Admin role required on at least one group tracking this tournament");
}
