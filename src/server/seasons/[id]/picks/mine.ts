// GET /api/seasons/:id/picks/mine — doc 03 §3.4: "own picks only." Always
// filtered server-side to the authenticated member (doc 03 §3.4's security
// requirement covers both endpoints: "/picks/mine must filter by the
// authenticated member").

import { db } from "../../../../lib/db/client.js";
import { requireUser } from "../../../../lib/auth/session.js";
import { requireSeasonMember, getMyPicks } from "../../../../lib/picks/service.js";
import { toPickResponse } from "../../../../lib/picks/dto.js";
import type { MinePicksResponse } from "../../../../lib/schemas/picks.js";
import { jsonResponse, pathSegment, withErrorHandling } from "../../../../lib/http.js";
import { AppError } from "../../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 2);
  const currentUser = await requireUser(db, request);
  const { memberId } = await requireSeasonMember(db, seasonId, currentUser.id, new Date());

  const rows = await getMyPicks(db, seasonId, memberId);
  const body: MinePicksResponse = { picks: rows.map(toPickResponse) };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
