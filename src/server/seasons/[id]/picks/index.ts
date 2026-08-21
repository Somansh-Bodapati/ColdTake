// PUT /api/seasons/:id/picks — doc 03 §3.4: { picks: [{questionId, answer}]
// } → upsert, rejected after lock. Per-question-type validation and the
// append-only pick_history write both happen in
// src/lib/picks/service.ts's upsertPicks (this session's brief, tasks 2-3);
// this handler is just membership + body parsing + status code.

import { db } from "../../../../lib/db/client.js";
import { requireUser } from "../../../../lib/auth/session.js";
import { requireSeasonMember, upsertPicks } from "../../../../lib/picks/service.js";
import { toPickResponse } from "../../../../lib/picks/dto.js";
import { putPicksRequestSchema, type MinePicksResponse } from "../../../../lib/schemas/picks.js";
import { hitRateLimit } from "../../../../lib/groups/rate-limit.js";
import { jsonResponse, parseJsonBody, pathSegment, withErrorHandling } from "../../../../lib/http.js";
import { AppError } from "../../../../lib/errors.js";

// doc 03 §5 checklist: "Rate limiting on join, pick submission, and comment
// endpoints" — join (api/groups/join.ts) and recompute
// (api/seasons/[id]/recompute.ts) already had one; this route didn't. The
// autosave UI (src/routes/season-picks.tsx) debounces 600ms per field, so a
// member filling out a whole slate can legitimately fire many PUTs in a
// short window — generous enough for that, tight enough to blunt a script
// hammering one member's own slate (same in-memory-limiter caveat as
// src/lib/groups/rate-limit.ts's doc comment).
const PICKS_RATE_LIMIT = { limit: 60, windowMs: 60 * 1000 };

async function handler(request: Request): Promise<Response> {
  if (request.method !== "PUT") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  const now = new Date();
  const { memberId } = await requireSeasonMember(db, seasonId, currentUser.id, now);

  const rateLimit = hitRateLimit(`picks:${memberId}`, PICKS_RATE_LIMIT);
  if (!rateLimit.allowed) {
    throw new AppError(429, "Too many pick submissions — try again shortly");
  }

  const body = await parseJsonBody(request, putPicksRequestSchema);
  const saved = await upsertPicks(db, seasonId, memberId, body.picks, now);

  const response: MinePicksResponse = { picks: saved.map(toPickResponse) };
  return jsonResponse(response);
}

export default withErrorHandling(handler);
