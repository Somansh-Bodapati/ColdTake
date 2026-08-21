// Zod schemas for the standings API boundary (doc 03 §3.5), shared by
// client and server — mirrors src/lib/schemas/picks.ts /
// src/lib/schemas/seasons.ts. Structurally mirrors
// src/lib/db/schema.ts's StandingsEntry/StandingsBreakdownEntry exactly,
// since the read endpoints (api/seasons/[id]/standings/*) serialize a
// standings_snapshot row's `standings` column directly — no recomputation,
// no reshaping.

import { z } from "zod";

export const standingsPickStatusSchema = z.enum([
  "correct",
  "partial",
  "incorrect",
  "pending",
  "no_pick",
]);

export const standingsBreakdownEntrySchema = z.object({
  questionId: z.string(),
  points: z.number(),
  maxPossible: z.number(),
  status: standingsPickStatusSchema,
  boldnessMultiplier: z.number(),
  explanation: z.string(),
});
export type StandingsBreakdownEntry = z.infer<typeof standingsBreakdownEntrySchema>;

export const standingsEntrySchema = z.object({
  memberId: z.string(),
  displayName: z.string(),
  rank: z.number(),
  points: z.number(),
  delta: z.number(),
  breakdown: z.array(standingsBreakdownEntrySchema),
});
export type StandingsEntry = z.infer<typeof standingsEntrySchema>;

// GET /api/seasons/:id/standings — doc 03 §3.5: "latest snapshot."
export const standingsSnapshotResponseSchema = z.object({
  seasonId: z.string(),
  isProjected: z.boolean(),
  computedAt: z.string(),
  standings: z.array(standingsEntrySchema),
});
export type StandingsSnapshotResponse = z.infer<typeof standingsSnapshotResponseSchema>;

// GET /api/seasons/:id/standings/history — doc 03 §3.5: "position over
// time for the chart." One entry per historical snapshot, oldest-to-newest
// concerns left to the chart consumer — the API returns newest-first, same
// order as the underlying index (season_id, computed_at desc).
export const standingsHistoryResponseSchema = z.object({
  snapshots: z.array(standingsSnapshotResponseSchema),
});
export type StandingsHistoryResponse = z.infer<typeof standingsHistoryResponseSchema>;

// POST /api/seasons/:id/recompute — doc 03 §3.5 [admin, rate-limited].
// Returns the freshly-written snapshot, same shape as the GET.
export const recomputeResponseSchema = standingsSnapshotResponseSchema;
export type RecomputeResponse = z.infer<typeof recomputeResponseSchema>;
