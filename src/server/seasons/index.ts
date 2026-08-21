// POST /api/seasons — doc 03 §3.3: { groupId, tournamentId, lockAt,
// questions[] } [admin]. Group-scoped admin action (this session's brief,
// task 6): verifies the caller is an admin of `groupId` before creating
// anything.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/groups/service";
import { createSeason, getQuestions } from "@/lib/seasons/service";
import { createSeasonRequestSchema, type SeasonDetailResponse } from "@/lib/schemas/seasons";
import { toQuestionResponse, toSeasonResponse } from "@/lib/seasons/dto";
import { jsonResponse, parseJsonBody, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const currentUser = await requireUser(db, request);
  const body = await parseJsonBody(request, createSeasonRequestSchema);
  await requireAdmin(db, body.groupId, currentUser.id);

  const seasonRow = await createSeason(db, body);
  const questionRows = await getQuestions(db, seasonRow.id);

  const responseBody: SeasonDetailResponse = {
    season: toSeasonResponse(seasonRow),
    questions: questionRows.map(toQuestionResponse),
  };
  return jsonResponse(responseBody, { status: 201 });
}

export default withErrorHandling(handler);
