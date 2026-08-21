// POST /api/seasons/:id/publish — doc 03 §3.3 [admin]. draft -> open (doc 03
// §4): requires >= 1 question and a lock_at in the future, enforced in
// src/lib/seasons/service.ts's publishSeason via src/lib/seasons/state.ts's
// canPublish.

import { db } from "../../../lib/db/client";
import { requireUser } from "../../../lib/auth/session";
import { requireSeasonAdmin, getQuestions, publishSeason } from "../../../lib/seasons/service";
import { toQuestionResponse, toSeasonResponse } from "../../../lib/seasons/dto";
import type { SeasonDetailResponse } from "../../../lib/schemas/seasons";
import { jsonResponse, pathSegment, withErrorHandling } from "../../../lib/http";
import { AppError } from "../../../lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  await requireSeasonAdmin(db, seasonId, currentUser.id, new Date());

  const updated = await publishSeason(db, seasonId, new Date());
  const questionRows = await getQuestions(db, seasonId);

  const body: SeasonDetailResponse = {
    season: toSeasonResponse(updated),
    questions: questionRows.map(toQuestionResponse),
  };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
