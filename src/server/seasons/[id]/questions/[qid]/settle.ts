// POST /api/seasons/:id/questions/:qid/settle — doc 03 §3.6 [admin]:
// { answer } manual settlement for `boolean`/`custom`/`numeric` questions
// (this session's brief, task 2's UI writes here), and — when the question
// already has a settled value — the doc 01 §4.3 admin-override escape
// hatch (task 3), which additionally requires `note`.
// src/lib/seasons/settlement.ts's settleQuestion is the single function
// behind both cases.

import { db } from "../../../../../lib/db/client";
import { requireUser } from "../../../../../lib/auth/session";
import { settleQuestion } from "../../../../../lib/seasons/settlement";
import { toQuestionResultResponse } from "../../../../../lib/seasons/settlement-dto";
import { toStandingsSnapshotResponse } from "../../../../../lib/standings/dto";
import { settleQuestionRequestSchema, type SettleQuestionResponse } from "../../../../../lib/schemas/settlement";
import { jsonResponse, parseJsonBody, pathSegment, withErrorHandling } from "../../../../../lib/http";
import { AppError } from "../../../../../lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const questionId = pathSegment(request, 1);
  const seasonId = pathSegment(request, 3);
  const currentUser = await requireUser(db, request);
  const input = await parseJsonBody(request, settleQuestionRequestSchema);

  const result = await settleQuestion(
    db,
    seasonId,
    questionId,
    input.answer,
    input.note,
    currentUser.id,
    new Date()
  );

  const body: SettleQuestionResponse = {
    questionResult: toQuestionResultResponse(result.questionResult),
    standings: toStandingsSnapshotResponse(result.snapshot),
  };
  return jsonResponse(body, { status: 201 });
}

export default withErrorHandling(handler);
