// POST /api/seasons/:id/settle — doc 03 §3.6 [admin]: "settles auto
// questions from results." Pulls the season's tournament through
// whichever StandingsProvider it's configured for (same lookup
// api/ingest/[tournamentId].ts uses, factored into
// src/lib/providers/resolve.ts), writes the resulting final `result` rows,
// flips the season locked -> settled, and recomputes standings in final
// (non-projected) mode — src/lib/seasons/settlement.ts's settleSeason does
// all of that in one call (see that module's doc comment for why no
// per-type special-casing is needed here).

import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { season } from "../../../lib/db/schema";
import { requireUser } from "../../../lib/auth/session";
import { settleSeason } from "../../../lib/seasons/settlement";
import { toSeasonResponse } from "../../../lib/seasons/dto";
import { toStandingsSnapshotResponse } from "../../../lib/standings/dto";
import { resolveStandingsProvider } from "../../../lib/providers/resolve";
import type { SettleSeasonResponse } from "../../../lib/schemas/settlement";
import { jsonResponse, pathSegment, withErrorHandling } from "../../../lib/http";
import { AppError } from "../../../lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  const now = new Date();

  // Only a cheap lookup to pick the right provider before settling —
  // settleSeason itself re-checks admin (requireSeasonAdmin) and re-loads
  // the season, so a non-admin or nonexistent seasonId is still rejected
  // there before anything is written; this just needs tournamentId first.
  const [seasonRow] = await db
    .select({ tournamentId: season.tournamentId })
    .from(season)
    .where(eq(season.id, seasonId))
    .limit(1);
  if (!seasonRow) {
    throw new AppError(404, "Season not found");
  }

  const provider = await resolveStandingsProvider(db, seasonRow.tournamentId);
  const result = await settleSeason(db, seasonId, provider, currentUser.id, now);

  const body: SettleSeasonResponse = {
    season: toSeasonResponse(result.season),
    standings: toStandingsSnapshotResponse(result.snapshot),
    resultKindsWritten: result.resultKindsWritten,
  };
  return jsonResponse(body, { status: 201 });
}

export default withErrorHandling(handler);
