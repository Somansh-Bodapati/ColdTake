// Thin fetch wrapper around the manual-standings admin endpoint, parsed with
// the shared Zod schema — same shape as src/lib/seasons/client.ts /
// src/lib/groups/client.ts.

import {
  ingestResponseSchema,
  manualStandingsRequestSchema,
  type IngestResponse,
  type ManualStandingsRequest,
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
