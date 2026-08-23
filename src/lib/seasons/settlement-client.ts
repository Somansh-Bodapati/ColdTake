// Thin fetch wrappers around the settlement API, parsed with the shared Zod
// schemas — same shape as src/lib/seasons/client.ts / src/lib/standings/client.ts.

import {
  questionResultsResponseSchema,
  settleQuestionRequestSchema,
  settleQuestionResponseSchema,
  settleSeasonResponseSchema,
  type QuestionResultsResponse,
  type SettleQuestionRequest,
  type SettleQuestionResponse,
  type SettleSeasonResponse,
} from "@/lib/schemas/settlement";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return fallback;
}

export async function settleSeasonRequest(seasonId: string): Promise<SettleSeasonResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/settle`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not settle the season"));
  }
  return settleSeasonResponseSchema.parse(await response.json());
}

export async function settleQuestionRequest(
  seasonId: string,
  questionId: string,
  input: SettleQuestionRequest
): Promise<SettleQuestionResponse> {
  const response = await fetch(
    `/api/seasons/${encodeURIComponent(seasonId)}/questions/${encodeURIComponent(questionId)}/settle`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settleQuestionRequestSchema.parse(input)),
    }
  );
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not settle the question"));
  }
  return settleQuestionResponseSchema.parse(await response.json());
}

export async function fetchQuestionResults(seasonId: string): Promise<QuestionResultsResponse> {
  const response = await fetch(`/api/seasons/${encodeURIComponent(seasonId)}/questions/results`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not load settled question results"));
  }
  return questionResultsResponseSchema.parse(await response.json());
}
