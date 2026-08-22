// GET /api/seasons/:id/questions/results — doc 03 §3.6 [admin]: the
// settlement UI's read path (src/routes/season-settle.tsx). Returns the
// latest question_result row per questionId for this season, so the client
// can show which questions are still pending versus already settled/
// overridden without re-deriving that from the standings snapshot (whose
// breakdown carries points/status, never the raw settled answer).

import { db } from "../../../../lib/db/client.js";
import { requireUser } from "../../../../lib/auth/session.js";
import { listQuestionResults } from "../../../../lib/seasons/settlement.js";
import { toQuestionResultResponse } from "../../../../lib/seasons/settlement-dto.js";
import type { QuestionResultsResponse } from "../../../../lib/schemas/settlement.js";
import { jsonResponse, pathSegment, withErrorHandling } from "../../../../lib/http.js";
import { AppError } from "../../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 2);
  const currentUser = await requireUser(db, request);

  const rows = await listQuestionResults(db, seasonId, currentUser.id, new Date());

  const body: QuestionResultsResponse = {
    results: Object.fromEntries(
      Object.entries(rows).map(([questionId, row]) => [questionId, toQuestionResultResponse(row)])
    ),
  };
  return jsonResponse(body, { status: 200 });
}

export default withErrorHandling(handler);
