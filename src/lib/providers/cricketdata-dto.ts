// Raw response shapes for CricketData.org (formerly CricAPI) — doc 02 §4.2's
// most-favored provider option, docs/DECISIONS.md: "Build CricketDataProvider
// modeled on CricketData.org's response shape ... but driven entirely by
// recorded fixtures in tests. Real API key wired in later."
//
// No vendor account exists yet (DECISIONS.md), so this is split into two
// confidence levels:
//   - The outer envelope (`status` / `reason` / `data`, success vs.
//     "failure" + reason string) is CricketData.org's documented, consistent
//     response wrapper across their v1 endpoints — this part is modeled with
//     reasonable confidence from their public API docs.
//   - The *inner* `data` shapes below (points-table row fields, stat-leader
//     entry fields, match/series-info fields) are this session's best-effort
//     reconstruction, not verified against a live key. Re-verify these
//     field names against a real account before depending on them in
//     production — see this session's report for the explicit list of what's
//     assumed. Every field that's plausibly returned as a numeric string by
//     a PHP-style JSON API is parsed with z.coerce.number() defensively.
//
// CricketDataProvider (cricketdata-provider.ts) uses these schemas to
// validate every response before mapping it — an unparseable envelope,
// a "failure" status, or a missing/mistyped field all surface as the same
// ProviderFetchError, which src/lib/providers/ingest.ts catches to keep
// serving the last good live_state rather than propagating.

import { z } from "zod";

const envelopeStatusSchema = z.enum(["success", "failure"]);

// GET /v1/series_points — the league table for a series (tournament).
export const cricketDataSeriesPointsRowSchema = z.object({
  // Assumed: CricketData.org's own team id, present when they've assigned
  // one; not every free-tier response is expected to include it, hence
  // optional — team-name matching is the fallback (cricketdata-provider.ts).
  teamId: z.string().optional(),
  teamName: z.string().min(1),
  matchPlayed: z.coerce.number().int().nonnegative(),
  win: z.coerce.number().int().nonnegative(),
  loss: z.coerce.number().int().nonnegative(),
  tie: z.coerce.number().int().nonnegative().optional().default(0),
  points: z.coerce.number().int().nonnegative(),
  nrr: z.coerce.number(),
});
export type CricketDataSeriesPointsRow = z.infer<typeof cricketDataSeriesPointsRowSchema>;

export const cricketDataSeriesPointsResponseSchema = z.object({
  status: envelopeStatusSchema,
  reason: z.string().optional(),
  data: z.array(cricketDataSeriesPointsRowSchema).nullable(),
});
export type CricketDataSeriesPointsResponse = z.infer<typeof cricketDataSeriesPointsResponseSchema>;

// GET /v1/stats/:category — assumed endpoint shape. CricketData.org's
// documented free tier does not clearly publish a generic "stat leaders by
// category" endpoint the way it does series_points/series_info; this is a
// reasonable placeholder shape (a flat leaderboard array) pending real
// account access, per this session's brief.
export const cricketDataStatEntrySchema = z.object({
  playerId: z.string().optional(),
  playerName: z.string().min(1),
  value: z.coerce.number(),
});
export type CricketDataStatEntry = z.infer<typeof cricketDataStatEntrySchema>;

export const cricketDataStatsResponseSchema = z.object({
  status: envelopeStatusSchema,
  reason: z.string().optional(),
  data: z.array(cricketDataStatEntrySchema).nullable(),
});
export type CricketDataStatsResponse = z.infer<typeof cricketDataStatsResponseSchema>;

// GET /v1/series_info — series metadata including its match list, used to
// find the final and its winner.
export const cricketDataMatchSchema = z.object({
  matchType: z.string().optional(),
  name: z.string().optional(),
  matchWinner: z.string().nullable().optional(),
});
export type CricketDataMatch = z.infer<typeof cricketDataMatchSchema>;

export const cricketDataSeriesInfoResponseSchema = z.object({
  status: envelopeStatusSchema,
  reason: z.string().optional(),
  data: z
    .object({
      matchList: z.array(cricketDataMatchSchema).optional(),
    })
    .nullable(),
});
export type CricketDataSeriesInfoResponse = z.infer<typeof cricketDataSeriesInfoResponseSchema>;
