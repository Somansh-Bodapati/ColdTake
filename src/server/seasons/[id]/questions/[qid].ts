// DELETE /api/seasons/:id/questions/:qid — doc 03 §3.3 [admin, only while
// draft/open].

import { db } from "../../../../lib/db/client.js";
import { requireUser } from "../../../../lib/auth/session.js";
import { requireSeasonAdmin, deleteQuestion } from "../../../../lib/seasons/service.js";
import type { OkResponse } from "../../../../lib/schemas/groups.js";
import { jsonResponse, pathSegment, withErrorHandling } from "../../../../lib/http.js";
import { AppError } from "../../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "DELETE") {
    throw new AppError(405, "Method not allowed");
  }

  const questionId = pathSegment(request, 0);
  const seasonId = pathSegment(request, 2);
  const currentUser = await requireUser(db, request);
  await requireSeasonAdmin(db, seasonId, currentUser.id, new Date());

  await deleteQuestion(db, seasonId, questionId, new Date());

  const body: OkResponse = { ok: true };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
