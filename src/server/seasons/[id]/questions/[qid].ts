// DELETE /api/seasons/:id/questions/:qid — doc 03 §3.3 [admin, only while
// draft/open].

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireSeasonAdmin, deleteQuestion } from "@/lib/seasons/service";
import type { OkResponse } from "@/lib/schemas/groups";
import { jsonResponse, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

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
