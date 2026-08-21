// Row -> API-response mapping for api/seasons/[id]/settle.ts,
// api/seasons/[id]/questions/[qid]/settle.ts, and api/seasons/[id]/void.ts —
// mirrors src/lib/seasons/dto.ts / src/lib/standings/dto.ts.

import type { QuestionResultRow } from "./settlement.js";
import type { QuestionResultResponse } from "../schemas/settlement.js";

export function toQuestionResultResponse(row: QuestionResultRow): QuestionResultResponse {
  return {
    id: row.id,
    questionId: row.questionId,
    answer: row.answer,
    source: row.source,
    note: row.note,
    settledBy: row.settledBy,
    settledAt: row.settledAt.toISOString(),
  };
}
