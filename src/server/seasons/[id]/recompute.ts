// POST /api/seasons/:id/recompute — doc 03 §3.5 [admin, rate-limited]. The
// only trigger for a standings_snapshot write in this session (task 1):
// there's no data-ingestion job yet (that's session 10/11), so an admin
// calls this manually after updating live_state/result rows. Never a cron —
// docs/DECISIONS.md: "on-demand with snapshot write... not a fixed daily
// cron."
//
// Reuses src/lib/groups/rate-limit.ts's in-memory limiter (see that file's
// own doc comment for its known serverless limitation) rather than adding a
// second copy — this route isn't group-scoped, but the limiter itself never
// was either; only its one existing call site (api/groups/join.ts) is.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireStandingsAdmin, recomputeStandings } from "@/lib/standings/service";
import { toStandingsSnapshotResponse } from "@/lib/standings/dto";
import { hitRateLimit } from "@/lib/groups/rate-limit";
import type { RecomputeResponse } from "@/lib/schemas/standings";
import { jsonResponse, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

// Recompute is meant to follow a real data change (an ingestion poll, doc
// 02 §4.1: "one poll per day"), not to be hammered — this just stops one
// warm instance from being driven into repeated full rescans of a season's
// picks by a runaway client.
const RECOMPUTE_RATE_LIMIT = { limit: 10, windowMs: 5 * 60 * 1000 };

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);

  const rateLimit = hitRateLimit(`recompute:${seasonId}`, RECOMPUTE_RATE_LIMIT);
  if (!rateLimit.allowed) {
    throw new AppError(429, "Standings were just recomputed — try again shortly");
  }

  const currentUser = await requireUser(db, request);
  await requireStandingsAdmin(db, seasonId, currentUser.id, new Date());

  const snapshot = await recomputeStandings(db, seasonId, new Date());

  const body: RecomputeResponse = toStandingsSnapshotResponse(snapshot);
  return jsonResponse(body, { status: 201 });
}

export default withErrorHandling(handler);
