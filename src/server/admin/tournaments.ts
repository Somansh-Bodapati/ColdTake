// POST /api/admin/tournaments — creates a real `tournament` row (plus its
// derived `team` rows) from a CricketData series an admin already picked
// via POST /api/admin/cricketdata/search-series. Costs exactly one real API
// hit (series_info) against the shared 100/day free-tier budget.
//
// Auth: requires only a signed-in session, same as POST /api/groups. This
// codebase has no "system admin" role anywhere (confirmed in
// src/lib/providers/admin.ts's own header comment: "No system-admin role
// exists anywhere in this schema"), and this action can't reuse
// requireTournamentAdmin (src/lib/providers/admin.ts) either — that helper
// requires an existing `season` row tracking the tournament to find a group
// to check admin-of, which is definitionally impossible before the
// tournament exists. The tournament catalogue is also explicitly
// system-owned and shared across every group (src/server/tournaments/index.ts's
// own header: "Not group-scoped ... system-owned"), so there is no single
// group to gate this against either. Given that, "any signed-in user may
// add a tournament to the shared catalogue" is the same trust model
// POST /api/groups already uses for group creation — a deliberate, honest
// scope decision, not an oversight. The real cost control is the shared
// daily API quota itself (one hit per tournament created), not a
// permissions wall.

import { db } from "../../lib/db/client.js";
import { requireUser } from "../../lib/auth/session.js";
import { getTournament } from "../../lib/seasons/service.js";
import {
  CricketDataAdminFetchError,
  createTournamentFromCricketDataSeries,
} from "../../lib/providers/cricketdata-admin.js";
import {
  createTournamentFromSeriesRequestSchema,
  type CreateTournamentFromSeriesResponse,
} from "../../lib/schemas/providers.js";
import { jsonResponse, parseJsonBody, withErrorHandling } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  await requireUser(db, request);
  const input = await parseJsonBody(request, createTournamentFromSeriesRequestSchema);

  const apiKey = process.env.CRICKETDATA_API_KEY;
  if (!apiKey) {
    throw new AppError(500, "CRICKETDATA_API_KEY is not configured");
  }

  let result;
  try {
    result = await createTournamentFromCricketDataSeries(db, { apiKey }, input);
  } catch (error) {
    if (error instanceof CricketDataAdminFetchError) {
      throw new AppError(502, `CricketData series lookup failed: ${error.message}`);
    }
    throw error;
  }

  const row = await getTournament(db, result.tournamentId);

  const body: CreateTournamentFromSeriesResponse = {
    tournament: {
      id: row.id,
      sport: row.sport,
      name: row.name,
      shortName: row.shortName,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      status: row.status,
      teamCount: row.teamCount,
      config: row.config,
    },
    teamsCreated: result.teamsCreated,
  };
  return jsonResponse(body, { status: 201 });
}

export default withErrorHandling(handler);
