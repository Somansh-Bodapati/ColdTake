// GET /api/seasons/:id/standings/history — doc 03 §3.5: "position over time
// for the chart." Same read discipline as ./index.ts: one indexed query
// against standings_snapshot alone, membership-gated, cached at the edge.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireStandingsReader, getStandingsHistory } from "@/lib/standings/service";
import { toStandingsSnapshotResponse } from "@/lib/standings/dto";
import type { StandingsHistoryResponse } from "@/lib/schemas/standings";
import { jsonResponse, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

const CACHE_CONTROL = "s-maxage=300";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 2);
  const currentUser = await requireUser(db, request);
  await requireStandingsReader(db, seasonId, currentUser.id, new Date());

  const rows = await getStandingsHistory(db, seasonId);

  const body: StandingsHistoryResponse = { snapshots: rows.map(toStandingsSnapshotResponse) };
  return jsonResponse(body, { headers: { "cache-control": CACHE_CONTROL } });
}

export default withErrorHandling(handler);
