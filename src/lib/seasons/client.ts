// Thin fetch wrappers around the seasons/tournaments API, parsed with the
// shared Zod schemas — same shape as src/lib/groups/client.ts.

import {
  createSeasonRequestSchema,
  questionInputSchema,
  questionResponseSchema,
  seasonDetailResponseSchema,
  tournamentCatalogueResponseSchema,
  updateSeasonRequestSchema,
  type CreateSeasonRequest,
  type QuestionInput,
  type QuestionResponse,
  type SeasonDetailResponse,
  type TournamentSummary,
  type UpdateSeasonRequest,
} from "@/lib/schemas/seasons";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return fallback;
}

export async function fetchTournamentCatalogue(): Promise<TournamentSummary[]> {
  // The server sets Cache-Control: public, max-age=300 on this response
  // (it's a cheap full-table read on a tiny table, safe to cache briefly
  // for casual repeat visits) -- but that means a browser can silently
  // serve a 5-minute-stale list right after an admin creates a new
  // tournament and navigates straight to season setup, making the one
  // thing they just created look like it never happened. Season setup is
  // exactly the place freshness matters more than shaving a trivial DB
  // read, so this specific caller always bypasses the cache.
  const response = await fetch("/api/tournaments", { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not load tournaments"));
  }
  return tournamentCatalogueResponseSchema.parse(await response.json()).tournaments;
}

export async function createSeason(input: CreateSeasonRequest): Promise<SeasonDetailResponse> {
  const response = await fetch("/api/seasons", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createSeasonRequestSchema.parse(input)),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not create the season"));
  }
  return seasonDetailResponseSchema.parse(await response.json());
}

export async function fetchSeasonDetail(seasonId: string): Promise<SeasonDetailResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not load the season"));
  }
  return seasonDetailResponseSchema.parse(await response.json());
}

export async function updateSeason(
  seasonId: string,
  patch: UpdateSeasonRequest
): Promise<SeasonDetailResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updateSeasonRequestSchema.parse(patch)),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not update the season"));
  }
  return seasonDetailResponseSchema.parse(await response.json());
}

export async function publishSeason(seasonId: string): Promise<SeasonDetailResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/publish`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not publish the season"));
  }
  return seasonDetailResponseSchema.parse(await response.json());
}

export async function addQuestion(seasonId: string, input: QuestionInput): Promise<QuestionResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/questions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(questionInputSchema.parse(input)),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not add the question"));
  }
  return questionResponseSchema.parse(await response.json());
}

export async function deleteQuestion(seasonId: string, questionId: string): Promise<void> {
  const response = await fetch(
    `/api/seasons/${encodeURIComponent(seasonId)}/questions/${encodeURIComponent(questionId)}`,
    { method: "DELETE", credentials: "include" }
  );
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not remove the question"));
  }
}
