// POST /api/seasons — doc 03 §3.3: { groupId, tournamentId, lockAt,
// questions[] } [admin]. Group-scoped admin action (this session's brief,
// task 6): verifies the caller is an admin of `groupId` before creating
// anything.

import { db } from "../../lib/db/client.js";
import { requireUser } from "../../lib/auth/session.js";
import { requireAdmin } from "../../lib/groups/service.js";
import { createSeason, getQuestions, getSeasonTeams } from "../../lib/seasons/service.js";
import { createSeasonRequestSchema, type SeasonDetailResponse } from "../../lib/schemas/seasons.js";
import { toQuestionResponse, toSeasonResponse } from "../../lib/seasons/dto.js";
import { jsonResponse, parseJsonBody, withErrorHandling } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const currentUser = await requireUser(db, request);
  const body = await parseJsonBody(request, createSeasonRequestSchema);
  await requireAdmin(db, body.groupId, currentUser.id);

  const seasonRow = await createSeason(db, body);
  const [questionRows, teamRows] = await Promise.all([
    getQuestions(db, seasonRow.id),
    getSeasonTeams(db, seasonRow.tournamentId),
  ]);

  const responseBody: SeasonDetailResponse = {
    season: toSeasonResponse(seasonRow),
    questions: questionRows.map(toQuestionResponse),
    teams: teamRows,
  };
  return jsonResponse(responseBody, { status: 201 });
}

export default withErrorHandling(handler);
