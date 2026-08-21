// POST /api/admin/manual-standings/:tournamentId — doc 03 §3.6 [group admin
// or system admin]: "manual table + stat leader entry, writes live_state
// with source='manual'." Saves the admin's input into
// manual_standings_input (src/lib/providers/manual-input.ts), then runs it
// through the same ingestion pipeline (src/lib/providers/ingest.ts) that the
// secret-guarded /api/ingest/:tournamentId route uses via ManualProvider —
// this route's only difference from that one is *who* is allowed to trigger
// it (a real signed-in group admin, not a shared secret) and *where* the
// data comes from (this request body, not whatever the provider already has
// stored) — everything downstream of "provider produced this data" is
// identical.

import { db } from "../../../lib/db/client.js";
import { requireUser } from "../../../lib/auth/session.js";
import { requireTournamentAdmin } from "../../../lib/providers/admin.js";
import { saveManualStandings } from "../../../lib/providers/manual-input.js";
import { ManualProvider } from "../../../lib/providers/manual-provider.js";
import { ingestTournament } from "../../../lib/providers/ingest.js";
import { toIngestResponse } from "../../../lib/providers/dto.js";
import { manualStandingsRequestSchema, type IngestResponse } from "../../../lib/schemas/providers.js";
import { jsonResponse, parseJsonBody, pathSegment, withErrorHandling } from "../../../lib/http.js";
import { AppError } from "../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const tournamentId = pathSegment(request, 0);
  const currentUser = await requireUser(db, request);
  await requireTournamentAdmin(db, tournamentId, currentUser.id);

  const input = await parseJsonBody(request, manualStandingsRequestSchema);
  const now = new Date();

  await saveManualStandings(
    db,
    {
      tournamentId,
      tableData: input.tableData,
      statLeaders: input.statLeaders,
      finalResult: input.finalResult,
      updatedBy: currentUser.id,
    },
    now
  );

  const provider = new ManualProvider(db);
  const result = await ingestTournament(db, provider, tournamentId, now);

  const body: IngestResponse = toIngestResponse(result);
  return jsonResponse(body);
}

export default withErrorHandling(handler);
