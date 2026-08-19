// Thin fetch wrappers around the standings API, parsed with the shared Zod
// schemas — same shape as src/lib/seasons/client.ts / src/lib/picks/client.ts.

import {
  recomputeResponseSchema,
  standingsHistoryResponseSchema,
  standingsSnapshotResponseSchema,
  type RecomputeResponse,
  type StandingsHistoryResponse,
  type StandingsSnapshotResponse,
} from "@/lib/schemas/standings";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return fallback;
}

// null (not thrown) on a 404 — "no snapshot yet" is a normal, expected page
// state (a season that's never been recomputed), not an error condition.
export async function fetchLatestStandings(seasonId: string): Promise<StandingsSnapshotResponse | null> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/standings`, {
    credentials: "include",
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not load the standings"));
  }
  return standingsSnapshotResponseSchema.parse(await response.json());
}

export async function fetchStandingsHistory(seasonId: string): Promise<StandingsHistoryResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/standings/history`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not load the standings history"));
  }
  return standingsHistoryResponseSchema.parse(await response.json());
}

export async function recomputeStandings(seasonId: string): Promise<RecomputeResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/recompute`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not recompute standings"));
  }
  return recomputeResponseSchema.parse(await response.json());
}
