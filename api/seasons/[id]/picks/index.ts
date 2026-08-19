// PUT /api/seasons/:id/picks — doc 03 §3.4: { picks: [{questionId, answer}]
// } → upsert, rejected after lock. Per-question-type validation and the
// append-only pick_history write both happen in
// src/lib/picks/service.ts's upsertPicks (this session's brief, tasks 2-3);
// this handler is just membership + body parsing + status code.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireSeasonMember, upsertPicks } from "@/lib/picks/service";
import { toPickResponse } from "@/lib/picks/dto";
import { putPicksRequestSchema, type MinePicksResponse } from "@/lib/schemas/picks";
import { jsonResponse, parseJsonBody, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "PUT") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  const now = new Date();
  const { memberId } = await requireSeasonMember(db, seasonId, currentUser.id, now);

  const body = await parseJsonBody(request, putPicksRequestSchema);
  const saved = await upsertPicks(db, seasonId, memberId, body.picks, now);

  const response: MinePicksResponse = { picks: saved.map(toPickResponse) };
  return jsonResponse(response);
}

export default withErrorHandling(handler);
