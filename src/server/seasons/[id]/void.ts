// POST /api/seasons/:id/void — doc 03 §3.6 [admin]: doc 01 §4.3's "team
// withdraws or tournament is abandoned" case. { reason } required —
// src/lib/seasons/settlement.ts's voidSeason writes it onto the season row
// as the audit trail for an otherwise-silent "no scores recorded" action.

import { db } from "../../../lib/db/client";
import { requireUser } from "../../../lib/auth/session";
import { voidSeason } from "../../../lib/seasons/settlement";
import { toSeasonResponse } from "../../../lib/seasons/dto";
import { voidSeasonRequestSchema, type VoidSeasonResponse } from "../../../lib/schemas/settlement";
import { jsonResponse, parseJsonBody, pathSegment, withErrorHandling } from "../../../lib/http";
import { AppError } from "../../../lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  const input = await parseJsonBody(request, voidSeasonRequestSchema);

  const updated = await voidSeason(db, seasonId, input.reason, currentUser.id, new Date());

  const body: VoidSeasonResponse = { season: toSeasonResponse(updated) };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
