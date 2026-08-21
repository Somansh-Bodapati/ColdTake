// Raw response shapes for CricketData.org (api.cricapi.com v1) — doc 02
// §4.2's most-favored provider option. Session 11 built this against a
// *guessed* shape (no vendor account existed yet); this session replaces
// every schema below with the real, verified shape captured live against a
// real API key and a real series ("Pakistan tour of England 2026") — see
// docs/DECISIONS.md for the full capture. Nothing here is reconstructed or
// assumed anymore.
//
// Real, load-bearing facts this file encodes:
//   - Auth is a query param (`apikey`), not a header; every call also sends
//     `offset=0` (pagination — series/match lists per tournament are small
//     enough that a second page is never expected for our use case).
//   - `series_info` embeds a series' FULL match list in one call
//     (`data.matchList`) — this is the only endpoint CricketDataProvider
//     calls for getTable. There is no `series_points` or `stats/:category`
//     endpoint on this API; those were Session 11's guesses and never
//     existed. `match_info` (per-match, richer) is documented in this file's
//     header comment only for context/tests — the provider never calls it
//     for routine table computation (100-requests/day free tier; see
//     docs/DECISIONS.md).
//   - `matchList` entries carry a human-readable `status` string, not
//     structured winner/score fields — CricketDataProvider parses `status`
//     against that match's own `teams` array, case-insensitively, only once
//     `matchEnded` is true.
//   - Every response carries an `info` block reporting the account's daily
//     usage (`hitsToday`/`hitsLimit` out of the free tier's 100/day) —
//     CricketDataProvider watches this on every successful call and warns
//     well before it becomes an outage (see that file's `warnIfNearLimit`).
//   - There is no player-level batting/bowling data anywhere on this tier
//     (confirmed via a real completed match's `match_info`: `score` is
//     innings-level runs/wickets/overs only) — stat-leader questions are a
//     permanent, not temporary, gap for this provider.

import { z } from "zod";

const envelopeStatusSchema = z.enum(["success", "failure"]);

// Present on every real response; extra fields beyond these are passed
// through rather than stripped, since this is diagnostic/observability data,
// not something CricketDataProvider maps into our domain shapes.
export const cricketDataInfoSchema = z
  .object({
    hitsToday: z.number().int().nonnegative().optional(),
    hitsUsed: z.number().int().nonnegative().optional(),
    hitsLimit: z.number().int().positive().optional(),
    credits: z.number().optional(),
  })
  .passthrough();
export type CricketDataInfo = z.infer<typeof cricketDataInfoSchema>;

// One row of GET /v1/series?apikey=X&offset=0's `data` array — the full
// series catalog. Not used by CricketDataProvider's three StandingsProvider
// methods today (a tournament's series id comes from `tournament.providerKey`,
// set once by an admin), but the real shape is captured here since it's
// cheap to keep accurate and may back an admin-facing "look up a series"
// tool later.
export const cricketDataSeriesListEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  odi: z.number().int().nonnegative().optional(),
  t20: z.number().int().nonnegative().optional(),
  test: z.number().int().nonnegative().optional(),
  squads: z.number().int().nonnegative().optional(),
  matches: z.number().int().nonnegative().optional(),
});
export type CricketDataSeriesListEntry = z.infer<typeof cricketDataSeriesListEntrySchema>;

export const cricketDataSeriesListResponseSchema = z.object({
  apikey: z.string().optional(),
  data: z.array(cricketDataSeriesListEntrySchema).default([]),
  status: envelopeStatusSchema.optional(),
  info: cricketDataInfoSchema.optional(),
});
export type CricketDataSeriesListResponse = z.infer<typeof cricketDataSeriesListResponseSchema>;

// One entry of series_info's `data.matchList` — verified live tonight.
// Deliberately does NOT include `matchWinner`/`score` (those only exist on
// the separate, per-call match_info endpoint) — winner is derived by
// CricketDataProvider by parsing `status` against `teams`, once
// `matchEnded` is true.
export const cricketDataMatchListEntrySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  matchType: z.string().optional(),
  status: z.string(),
  venue: z.string().optional(),
  date: z.string().optional(),
  dateTimeGMT: z.string().optional(),
  teams: z.array(z.string()).default([]),
  fantasyEnabled: z.boolean().optional(),
  bbbEnabled: z.boolean().optional(),
  hasSquad: z.boolean().optional(),
  matchStarted: z.boolean().default(false),
  matchEnded: z.boolean().default(false),
});
export type CricketDataMatchListEntry = z.infer<typeof cricketDataMatchListEntrySchema>;

export const cricketDataSeriesInfoInfoSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  startdate: z.string().optional(),
  enddate: z.string().optional(),
  odi: z.number().int().nonnegative().optional(),
  t20: z.number().int().nonnegative().optional(),
  test: z.number().int().nonnegative().optional(),
  squads: z.number().int().nonnegative().optional(),
  matches: z.number().int().nonnegative().optional(),
});

// GET /v1/series_info?apikey=X&offset=0&id=<seriesId> — the ONLY endpoint
// CricketDataProvider's getTable calls: one request buys the full match list
// for the series, which is everything table computation needs.
export const cricketDataSeriesInfoResponseSchema = z.object({
  status: envelopeStatusSchema,
  reason: z.string().optional(),
  data: z
    .object({
      info: cricketDataSeriesInfoInfoSchema.optional(),
      matchList: z.array(cricketDataMatchListEntrySchema).default([]),
    })
    .nullable(),
  info: cricketDataInfoSchema.optional(),
});
export type CricketDataSeriesInfoResponse = z.infer<typeof cricketDataSeriesInfoResponseSchema>;

// GET /v1/match_info?apikey=X&offset=0&id=<matchId> — richer per-match shape,
// costs its own API call. Not called anywhere in CricketDataProvider for
// routine table computation (series_info's matchList + status parsing is
// sufficient, and the free tier's 100/day budget doesn't afford a call per
// match); kept here only so tests/fixtures can document the real shape,
// including the confirmed absence of any player-level stats (`score` is
// innings-level runs/wickets/overs only).
export const cricketDataMatchInfoScoreEntrySchema = z.object({
  r: z.number().optional(),
  w: z.number().optional(),
  o: z.number().optional(),
  inning: z.string().optional(),
});

export const cricketDataMatchInfoDataSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  matchType: z.string().optional(),
  status: z.string(),
  venue: z.string().optional(),
  date: z.string().optional(),
  dateTimeGMT: z.string().optional(),
  teams: z.array(z.string()).default([]),
  score: z.array(cricketDataMatchInfoScoreEntrySchema).optional(),
  tossWinner: z.string().optional(),
  tossChoice: z.string().optional(),
  matchWinner: z.string().nullable().optional(),
  series_id: z.string().optional(),
  matchStarted: z.boolean().default(false),
  matchEnded: z.boolean().default(false),
});

export const cricketDataMatchInfoResponseSchema = z.object({
  status: envelopeStatusSchema,
  reason: z.string().optional(),
  data: cricketDataMatchInfoDataSchema.nullable(),
  info: cricketDataInfoSchema.optional(),
});
export type CricketDataMatchInfoResponse = z.infer<typeof cricketDataMatchInfoResponseSchema>;
