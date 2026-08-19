// Thin fetch wrappers around the picks API, parsed with the shared Zod
// schemas — same shape as src/lib/seasons/client.ts.

import {
  allPicksResponseSchema,
  minePicksResponseSchema,
  putPicksRequestSchema,
  type AllPicksResponse,
  type MinePicksResponse,
  type PutPicksRequest,
} from "@/lib/schemas/picks";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return fallback;
}

export async function fetchMyPicks(seasonId: string): Promise<MinePicksResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/picks/mine`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not load your picks"));
  }
  return minePicksResponseSchema.parse(await response.json());
}

export async function putPicks(seasonId: string, body: PutPicksRequest): Promise<MinePicksResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/picks`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(putPicksRequestSchema.parse(body)),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not save your pick"));
  }
  return minePicksResponseSchema.parse(await response.json());
}

export async function fetchAllPicks(seasonId: string): Promise<AllPicksResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/picks/all`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not load the reveal"));
  }
  return allPicksResponseSchema.parse(await response.json());
}
