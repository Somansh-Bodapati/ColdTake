// Thin fetch wrappers around the provider-facing admin API — manual
// standings, CricketData series search, and CricketData-backed tournament
// creation — parsed with the shared Zod schemas, same shape as
// src/lib/seasons/client.ts / src/lib/groups/client.ts.

import {
  ingestResponseSchema,
  manualStandingsRequestSchema,
  searchCricketDataSeriesRequestSchema,
  searchCricketDataSeriesResponseSchema,
  createTournamentFromSeriesRequestSchema,
  createTournamentFromSeriesResponseSchema,
  type IngestResponse,
  type ManualStandingsRequest,
  type CricketDataSeriesSummary,
  type CreateTournamentFromSeriesRequest,
  type CreateTournamentFromSeriesResponse,
} from "@/lib/schemas/providers";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return fallback;
}

export async function saveManualStandings(
  tournamentId: string,
  input: ManualStandingsRequest
): Promise<IngestResponse> {
  const response = await fetch(`/api/admin/manual-standings/${encodeURIComponent(tournamentId)}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(manualStandingsRequestSchema.parse(input)),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not save manual standings"));
  }
  return ingestResponseSchema.parse(await response.json());
}

export interface CricketDataSeriesSearchPage {
  series: CricketDataSeriesSummary[];
  total: number;
  nextOffset: number | null;
}

export async function searchCricketDataSeries(
  query: string,
  offset = 0
): Promise<CricketDataSeriesSearchPage> {
  const response = await fetch("/api/admin/cricketdata/search-series", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(searchCricketDataSeriesRequestSchema.parse({ query, offset })),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not search CricketData"));
  }
  return searchCricketDataSeriesResponseSchema.parse(await response.json());
}

export async function createTournamentFromSeries(
  input: CreateTournamentFromSeriesRequest
): Promise<CreateTournamentFromSeriesResponse> {
  const response = await fetch("/api/admin/tournaments", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createTournamentFromSeriesRequestSchema.parse(input)),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not create the tournament"));
  }
  return createTournamentFromSeriesResponseSchema.parse(await response.json());
}
