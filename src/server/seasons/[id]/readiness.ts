// GET /api/seasons/:id/readiness [admin] — the "lock now" readiness check
// (this session's brief): lets the group admin see, before manually locking
// a season early, which active members have completed their full slate and
// exactly which questions the rest are missing. Admin-scoped like every
// other seasons/:id write-adjacent endpoint (requireSeasonAdmin) — this is
// read-only, but it exposes per-member pick completion, which members
// themselves must never see before lock (CLAUDE.md rule 6).

import { db } from "../../../lib/db/client.js";
import { requireUser } from "../../../lib/auth/session.js";
import { requireSeasonAdmin } from "../../../lib/seasons/service.js";
import { getPickReadiness } from "../../../lib/picks/service.js";
import type { ReadinessResponse } from "../../../lib/schemas/picks.js";
import { jsonResponse, pathSegment, withErrorHandling } from "../../../lib/http.js";
import { AppError } from "../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  const now = new Date();
  await requireSeasonAdmin(db, seasonId, currentUser.id, now);

  const members = await getPickReadiness(db, seasonId, now);
  const body: ReadinessResponse = { members };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
