// GET /api/seasons/:id/standings — doc 03 §3.5: "latest snapshot.
// Cache-Control: s-maxage=300." Session 9's brief, task 2-3: this reads
// standings_snapshot alone — one indexed row fetch
// (src/lib/standings/service.ts's getLatestSnapshot) — and never calls
// `score()` or joins across picks/questions/results. Membership is the only
// gate (task 6); unlike picks/all there's no lock-state reveal rule here —
// any current group member can see standings at any time, projected or
// final.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireStandingsReader, getLatestSnapshot } from "@/lib/standings/service";
import { toStandingsSnapshotResponse } from "@/lib/standings/dto";
import type { StandingsSnapshotResponse } from "@/lib/schemas/standings";
import { jsonResponse, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

// doc 02 §3.4's recommended stack: HTTP caching on top of the materialised
// snapshot, so a page view costs "one indexed row read at worst, and
// usually nothing at all."
const CACHE_CONTROL = "s-maxage=300";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  await requireStandingsReader(db, seasonId, currentUser.id, new Date());

  const snapshot = await getLatestSnapshot(db, seasonId);
  if (!snapshot) {
    throw new AppError(404, "No standings have been computed for this season yet");
  }

  const body: StandingsSnapshotResponse = toStandingsSnapshotResponse(snapshot);
  return jsonResponse(body, { headers: { "cache-control": CACHE_CONTROL } });
}

export default withErrorHandling(handler);
