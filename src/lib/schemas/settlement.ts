// Zod schemas for the settlement API boundary (doc 03 §3.6), shared by
// client and server — mirrors src/lib/schemas/standings.ts /
// src/lib/schemas/picks.ts. `pickAnswerSchema` is reused verbatim for a
// settled question's answer: doc 03 §2.1's ResultSet.questionResults doc
// comment is explicit that a manual settlement answer is "shaped exactly
// like a pick answer."

import { z } from "zod";
import { pickAnswerSchema } from "./picks.js";
import { seasonResponseSchema } from "./seasons.js";
import { standingsSnapshotResponseSchema } from "./standings.js";

export const resultKindSchema = z.enum(["final_table", "stat_leaders", "final_result"]);

// POST /api/seasons/:id/settle — doc 03 §3.6 [admin]: no request body, just
// the season being settled from whatever its StandingsProvider reports.
export const settleSeasonResponseSchema = z.object({
  season: seasonResponseSchema,
  standings: standingsSnapshotResponseSchema,
  resultKindsWritten: z.array(resultKindSchema),
});
export type SettleSeasonResponse = z.infer<typeof settleSeasonResponseSchema>;

export const questionResultSourceSchema = z.enum(["manual", "override"]);

export const questionResultResponseSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  answer: pickAnswerSchema,
  source: questionResultSourceSchema,
  note: z.string().nullable(),
  settledBy: z.string(),
  settledAt: z.string(),
});
export type QuestionResultResponse = z.infer<typeof questionResultResponseSchema>;

// POST /api/seasons/:id/questions/:qid/settle — doc 03 §3.6 [admin]:
// { answer } for a first-time manual settlement; doc 01 §4.3's admin
// override on an already-settled question additionally requires `note`
// (enforced in src/lib/seasons/settlement.ts, not here, since whether a
// note is *required* depends on whether the question already has a settled
// value — a fact this schema has no way to know).
export const settleQuestionRequestSchema = z.object({
  answer: pickAnswerSchema,
  note: z.string().trim().min(1).max(1000).optional(),
});
export type SettleQuestionRequest = z.infer<typeof settleQuestionRequestSchema>;

export const settleQuestionResponseSchema = z.object({
  questionResult: questionResultResponseSchema,
  standings: standingsSnapshotResponseSchema,
});
export type SettleQuestionResponse = z.infer<typeof settleQuestionResponseSchema>;

// GET /api/seasons/:id/questions/results — doc 03 §3.6 [admin]: the
// settlement UI's read path for "which questions are still pending vs
// already settled, and what was the settled answer" (src/lib/seasons/
// settlement.ts's listQuestionResults). Keyed by questionId; a question
// absent from `results` has never been settled.
export const questionResultsResponseSchema = z.object({
  results: z.record(z.string(), questionResultResponseSchema),
});
export type QuestionResultsResponse = z.infer<typeof questionResultsResponseSchema>;

// POST /api/seasons/:id/void — doc 03 §3.6 [admin]: doc 01 §4.3's "team
// withdraws or tournament is abandoned" case. `reason` is required — see
// settleQuestionRequestSchema's note above on why this lives in the service
// layer for settle-question but can be a plain required field here (voiding
// always needs a reason, there's no "first time is optional" case).
export const voidSeasonRequestSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required to void a season").max(500),
});
export type VoidSeasonRequest = z.infer<typeof voidSeasonRequestSchema>;

export const voidSeasonResponseSchema = z.object({
  season: seasonResponseSchema,
});
export type VoidSeasonResponse = z.infer<typeof voidSeasonResponseSchema>;
