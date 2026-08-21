// POST /api/admin/cricketdata/search-series — proxies GET /v1/series on
// CricketData.org for the tournament-creation flow's first step ("find a
// real series"). Requires only a signed-in session, not group-admin or
// tournament-admin: it never touches the DB, and the free tier's 100/day
// cap is shared across the whole app regardless of who's asking — gating it
// further would protect a quota that's just as exposed by every other
// authenticated action that eventually triggers ingestion. The real
// protection against accidental burn is on the *write* side
// (POST /api/admin/tournaments, which actually spends a hit) — see that
// route's own comment.

import { db } from "../../../lib/db/client.js";
import { requireUser } from "../../../lib/auth/session.js";
import { CricketDataAdminFetchError, searchCricketDataSeries } from "../../../lib/providers/cricketdata-admin.js";
import {
  searchCricketDataSeriesRequestSchema,
  type SearchCricketDataSeriesResponse,
} from "../../../lib/schemas/providers.js";
import { jsonResponse, parseJsonBody, withErrorHandling } from "../../../lib/http.js";
import { AppError } from "../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  await requireUser(db, request);
  const { query } = await parseJsonBody(request, searchCricketDataSeriesRequestSchema);

  const apiKey = process.env.CRICKETDATA_API_KEY;
  if (!apiKey) {
    throw new AppError(500, "CRICKETDATA_API_KEY is not configured");
  }

  let results;
  try {
    results = await searchCricketDataSeries({ apiKey }, query);
  } catch (error) {
    // Surfaces as a clear, catchable 502 rather than a generic 500 —
    // network failure, malformed upstream JSON, or CricketData's own
    // failure envelope are all real, expected failure modes for a live
    // third-party call, not bugs in this route.
    if (error instanceof CricketDataAdminFetchError) {
      throw new AppError(502, `CricketData search failed: ${error.message}`);
    }
    throw error;
  }

  const body: SearchCricketDataSeriesResponse = {
    series: results.map((entry) => ({
      id: entry.id,
      name: entry.name,
      startDate: entry.startDate ?? null,
      endDate: entry.endDate ?? null,
      matches: entry.matches ?? null,
    })),
  };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
