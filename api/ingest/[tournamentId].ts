// POST /api/ingest/:tournamentId — doc 03 §3.7: "Bearer INGEST_SECRET ->
// runs the configured StandingsProvider, writes live_state, recomputes
// standings_snapshot for every active season on that tournament." The only
// route in this codebase guarded by a shared secret instead of a session
// cookie — meant for a scheduler (doc 02 §4.4: GitHub Actions/Vercel Cron)
// or a future real-provider poll, not a signed-in user.
//
// ManualProvider is the only StandingsProvider implementation this session
// ships (doc 02 §4.3), so it's the only one wired up here; a later session
// adding CricketDataProvider swaps this one line, nothing else in the
// pipeline.

import { db } from "@/lib/db/client";
import { ManualProvider } from "@/lib/providers/manual-provider";
import { ingestTournament } from "@/lib/providers/ingest";
import { isValidIngestSecret, readBearerToken } from "@/lib/providers/ingest-auth";
import { toIngestResponse } from "@/lib/providers/dto";
import type { IngestResponse } from "@/lib/schemas/providers";
import { jsonResponse, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const tournamentId = pathSegment(request, 0);

  const expectedSecret = process.env.INGEST_SECRET;
  if (!expectedSecret) {
    throw new AppError(500, "INGEST_SECRET is not configured");
  }
  if (!isValidIngestSecret(readBearerToken(request), expectedSecret)) {
    throw new AppError(401, "Invalid or missing ingest secret");
  }

  const provider = new ManualProvider(db);
  const result = await ingestTournament(db, provider, tournamentId, new Date());

  const body: IngestResponse = toIngestResponse(result);
  return jsonResponse(body);
}

export default withErrorHandling(handler);
