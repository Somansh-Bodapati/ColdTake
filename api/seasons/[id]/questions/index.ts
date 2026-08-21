// POST /api/seasons/:id/questions — doc 03 §3.3: { type, prompt, config,
// points } [admin, only while draft/open]. This is both "add a template
// question" and the custom question builder (this session's brief, task 4)
// — the same endpoint, since a custom question is just `type: "custom"` with
// `config.options`, validated by questionInputSchema exactly like every
// other type.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireSeasonAdmin, addQuestion } from "@/lib/seasons/service";
import { toQuestionResponse } from "@/lib/seasons/dto";
import { questionInputSchema, type QuestionResponse } from "@/lib/schemas/seasons";
import { jsonResponse, parseJsonBody, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  await requireSeasonAdmin(db, seasonId, currentUser.id, new Date());

  const input = await parseJsonBody(request, questionInputSchema);
  const inserted = await addQuestion(db, seasonId, input, new Date());

  const body: QuestionResponse = toQuestionResponse(inserted);
  return jsonResponse(body, { status: 201 });
}

export default withErrorHandling(handler);
