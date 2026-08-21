// Zod schemas for the ingestion/manual-standings API boundary (doc 03
// §3.6-3.7), shared by client and server — mirrors src/lib/schemas/standings.ts.
// Structurally matches src/lib/db/schema.ts's LiveStateTableRow /
// LiveStateStatLeaderEntry exactly, since this is the admin-facing input to
// (and the response shape of) src/lib/providers/ingest.ts.

import { z } from "zod";
import { tournamentSummarySchema } from "./seasons.js";

export const teamStandingSchema = z
  .object({
    teamId: z.string().trim().min(1),
    played: z.number().int().nonnegative(),
    won: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
    nrr: z.number(),
    position: z.number().int().positive(),
  })
  .strict();
export type TeamStandingInput = z.infer<typeof teamStandingSchema>;

export const playerStatSchema = z
  .object({
    playerId: z.string().trim().min(1),
    value: z.number(),
  })
  .strict();
export type PlayerStatInput = z.infer<typeof playerStatSchema>;

export const manualFinalResultSchema = z
  .object({
    championTeamId: z.string().trim().min(1).optional(),
    runnerUpTeamId: z.string().trim().min(1).optional(),
  })
  .strict();
export type ManualFinalResultInput = z.infer<typeof manualFinalResultSchema>;

// POST /api/admin/manual-standings/:tournamentId — doc 03 §3.6 [group admin
// or system admin]: "manual table + stat leader entry."
export const manualStandingsRequestSchema = z.object({
  tableData: z.array(teamStandingSchema).min(1, "At least one team row is required"),
  statLeaders: z.record(z.string(), z.array(playerStatSchema)).default({}),
  finalResult: manualFinalResultSchema.optional(),
});
export type ManualStandingsRequest = z.infer<typeof manualStandingsRequestSchema>;

// Shared response for both ingestion triggers (POST /api/ingest/:tournamentId
// and the manual-standings endpoint above) — doc 03 §3.7: writes live_state,
// then recomputes standings_snapshot for every active season on that
// tournament. `recomputedSeasonIds` lets a caller see the fan-out actually
// happened, without echoing back every full snapshot.
export const ingestResponseSchema = z.object({
  tournamentId: z.string(),
  source: z.string(),
  fetchedAt: z.string(),
  tableData: z.array(teamStandingSchema),
  statLeaders: z.record(z.string(), z.array(playerStatSchema)),
  recomputedSeasonIds: z.array(z.string()),
});
export type IngestResponse = z.infer<typeof ingestResponseSchema>;

// POST /api/admin/cricketdata/search-series — proxies GET /v1/series on
// CricketData.org (real, verified shape; see cricketdata-dto.ts's header).
// `query` mirrors that endpoint's own `search` param name loosely rather
// than exactly, since this is our request shape, not a passthrough of theirs.
export const searchCricketDataSeriesRequestSchema = z.object({
  query: z.string().trim().min(2, "Search query must be at least 2 characters"),
  // Row-based, not page-based -- verified live against the real API: offset
  // echoes back as-is in the response's offsetRows, and passing offset=1
  // shifted the result set by exactly one row, not one page of 25. "Load
  // more" advances this by however many rows the previous page returned.
  offset: z.number().int().nonnegative().default(0),
});
export type SearchCricketDataSeriesRequest = z.infer<typeof searchCricketDataSeriesRequestSchema>;

export const cricketDataSeriesSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  matches: z.number().int().nonnegative().nullable(),
});
export type CricketDataSeriesSummary = z.infer<typeof cricketDataSeriesSummarySchema>;

export const searchCricketDataSeriesResponseSchema = z.object({
  series: z.array(cricketDataSeriesSummarySchema),
  // From CricketData's own info.totalRows/offsetRows -- lets the client show
  // "Load more" only when there's actually more, and know what offset to
  // request next, without a second guessing call.
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
});
export type SearchCricketDataSeriesResponse = z.infer<typeof searchCricketDataSeriesResponseSchema>;

// POST /api/admin/tournaments — creates a real `tournament` row (plus its
// `team` rows) from an admin-chosen CricketData series. `seriesName` is
// carried from the search step (task 2's UI already has it in hand) so the
// tournament's `name`/`shortName` don't depend on series_info's own
// `data.info.name` being present (verified live tonight: it sometimes is,
// but the top-level `series` search result's `name` is the more reliable
// source since it's what the admin actually picked).
export const createTournamentFromSeriesRequestSchema = z.object({
  seriesId: z.string().trim().min(1),
  seriesName: z.string().trim().min(1),
});
export type CreateTournamentFromSeriesRequest = z.infer<typeof createTournamentFromSeriesRequestSchema>;

export const createTournamentFromSeriesResponseSchema = z.object({
  tournament: tournamentSummarySchema,
  teamsCreated: z.number().int().nonnegative(),
});
export type CreateTournamentFromSeriesResponse = z.infer<typeof createTournamentFromSeriesResponseSchema>;
