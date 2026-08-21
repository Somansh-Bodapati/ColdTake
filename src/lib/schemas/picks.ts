// Zod schemas for the picks API boundary (doc 03 §3.4), shared by client
// and server — mirrors src/lib/schemas/seasons.ts.
//
// `pickAnswerSchema` is a loose structural check of the `PickAnswer` union
// (src/lib/db/schema.ts) — every field optional, since which fields matter
// depends on the question's type. The actual per-type shape enforcement
// (task 2 of this session's brief: "a pick's answer shape must match what
// that question's resolver expects") happens one layer down, in
// src/lib/picks/service.ts, by calling straight into the same
// `QuestionResolver.validate` each src/lib/scoring/resolvers/*.ts file
// already defines and already has tests for — reusing that instead of
// hand-duplicating a second copy of "a champion pick needs teamId" as a
// parallel discriminated-union schema, which would drift the moment a
// resolver's shape changed. This schema's job is just to reject garbage
// JSON (wrong types, unknown keys) before it reaches that call.

import { z } from "zod";

export const pickAnswerSchema = z
  .object({
    teamId: z.string().min(1).optional(),
    teamIds: z.array(z.string().min(1)).optional(),
    playerId: z.string().min(1).optional(),
    value: z.number().optional(),
    bool: z.boolean().optional(),
    optionId: z.string().min(1).optional(),
  })
  .strict();
export type PickAnswerInput = z.infer<typeof pickAnswerSchema>;

export const pickInputSchema = z.object({
  questionId: z.string().min(1, "questionId is required"),
  answer: pickAnswerSchema,
});
export type PickInput = z.infer<typeof pickInputSchema>;

// PUT /api/seasons/:id/picks — doc 03 §3.4: { picks: [{questionId,
// answer}] } → upsert, rejected after lock. Capped at 50, matching
// questionInputSchema's per-season question cap (src/lib/schemas/seasons.ts)
// — a slate can't have more questions than that, so a pick batch never
// needs to either.
export const putPicksRequestSchema = z.object({
  picks: z.array(pickInputSchema).min(1, "At least one pick is required").max(50, "Too many picks"),
});
export type PutPicksRequest = z.infer<typeof putPicksRequestSchema>;

export const pickResponseSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  answer: pickAnswerSchema,
  submittedAt: z.string(),
  updatedAt: z.string(),
});
export type PickResponse = z.infer<typeof pickResponseSchema>;

// GET /api/seasons/:id/picks/mine — doc 03 §3.4: "own picks only."
export const minePicksResponseSchema = z.object({
  picks: z.array(pickResponseSchema),
});
export type MinePicksResponse = z.infer<typeof minePicksResponseSchema>;

// GET /api/seasons/:id/picks/all — doc 03 §3.4: "403 before lock, full
// reveal after." One entry per member in the season's frozen
// member_snapshot (or the active roster, if a season somehow reaches this
// endpoint's 200 branch without one yet — see src/lib/picks/service.ts) so
// doc 01 §2.5's "members who never submitted are marked 'no slate'" is
// exactly the members whose `picks` array here is empty — the UI derives
// that state rather than the API inventing a separate boolean for it.
export const memberPicksSchema = z.object({
  memberId: z.string(),
  userId: z.string(),
  displayName: z.string(),
  picks: z.array(pickResponseSchema),
});
export type MemberPicks = z.infer<typeof memberPicksSchema>;

export const allPicksResponseSchema = z.object({
  members: z.array(memberPicksSchema),
});
export type AllPicksResponse = z.infer<typeof allPicksResponseSchema>;

// GET /api/seasons/:id/readiness [admin] — the "lock now" readiness check
// (this session's brief): per active member, either complete (empty
// `missingQuestions`) or exactly which questions they haven't answered yet.
export const missingQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
});
export type MissingQuestion = z.infer<typeof missingQuestionSchema>;

export const memberReadinessSchema = z.object({
  memberId: z.string(),
  displayName: z.string(),
  missingQuestions: z.array(missingQuestionSchema),
});
export type MemberReadiness = z.infer<typeof memberReadinessSchema>;

export const readinessResponseSchema = z.object({
  members: z.array(memberReadinessSchema),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
