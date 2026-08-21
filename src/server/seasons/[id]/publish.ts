// POST /api/seasons/:id/publish — doc 03 §3.3 [admin]. draft -> open (doc 03
// §4): requires >= 1 question and a lock_at in the future, enforced in
// src/lib/seasons/service.ts's publishSeason via src/lib/seasons/state.ts's
// canPublish.

import { db } from "../../../lib/db/client.js";
import { requireUser } from "../../../lib/auth/session.js";
import { requireSeasonAdmin, getQuestions, getSeasonTeams, publishSeason } from "../../../lib/seasons/service.js";
import { toQuestionResponse, toSeasonResponse } from "../../../lib/seasons/dto.js";
import type { SeasonDetailResponse } from "../../../lib/schemas/seasons.js";
import { jsonResponse, pathSegment, withErrorHandling } from "../../../lib/http.js";
import { AppError } from "../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  await requireSeasonAdmin(db, seasonId, currentUser.id, new Date());

  const updated = await publishSeason(db, seasonId, new Date());
  const [questionRows, teamRows] = await Promise.all([
    getQuestions(db, seasonId),
    getSeasonTeams(db, updated.tournamentId),
  ]);

  const body: SeasonDetailResponse = {
    season: toSeasonResponse(updated),
    questions: questionRows.map(toQuestionResponse),
    teams: teamRows,
  };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
