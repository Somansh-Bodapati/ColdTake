// GET /api/seasons/:id -> season + questions (doc 03 §3.3; the "+ picks if
// locked" half of that line is a later session's concern once picks exist).
// PATCH /api/seasons/:id { lockAt, scoringConfig } [admin, only while
// draft/open]. GET is membership-scoped, PATCH is admin-scoped (this
// session's brief, task 6).

import { db } from "../../../lib/db/client";
import { requireUser } from "../../../lib/auth/session";
import { requireSeasonAdmin, requireSeasonMembership, getQuestions, updateSeason } from "../../../lib/seasons/service";
import { toQuestionResponse, toSeasonResponse } from "../../../lib/seasons/dto";
import { updateSeasonRequestSchema, type SeasonDetailResponse } from "../../../lib/schemas/seasons";
import { jsonResponse, parseJsonBody, pathSegment, withErrorHandling } from "../../../lib/http";
import { AppError } from "../../../lib/errors";

async function handleGet(request: Request): Promise<Response> {
  const seasonId = pathSegment(request, 0);
  const currentUser = await requireUser(db, request);
  const seasonRow = await requireSeasonMembership(db, seasonId, currentUser.id, new Date());

  const questionRows = await getQuestions(db, seasonId);
  const body: SeasonDetailResponse = {
    season: toSeasonResponse(seasonRow),
    questions: questionRows.map(toQuestionResponse),
  };
  return jsonResponse(body);
}

async function handlePatch(request: Request): Promise<Response> {
  const seasonId = pathSegment(request, 0);
  const currentUser = await requireUser(db, request);
  await requireSeasonAdmin(db, seasonId, currentUser.id, new Date());

  const patch = await parseJsonBody(request, updateSeasonRequestSchema);
  const updated = await updateSeason(db, seasonId, patch, new Date());
  const questionRows = await getQuestions(db, seasonId);

  const body: SeasonDetailResponse = {
    season: toSeasonResponse(updated),
    questions: questionRows.map(toQuestionResponse),
  };
  return jsonResponse(body);
}

async function handler(request: Request): Promise<Response> {
  if (request.method === "GET") {
    return handleGet(request);
  }
  if (request.method === "PATCH") {
    return handlePatch(request);
  }
  throw new AppError(405, "Method not allowed");
}

export default withErrorHandling(handler);
