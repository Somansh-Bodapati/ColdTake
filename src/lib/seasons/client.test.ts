// Real bug, reported in production: a tournament created via the admin
// search-and-create flow didn't show up in season setup's tournament list.
// Root cause: GET /api/tournaments sets Cache-Control: public, max-age=300,
// and this client wrapper's fetch had no cache option, so the browser could
// silently serve a pre-creation cached response for up to 5 minutes.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTournamentCatalogue } from "./client";

describe("fetchTournamentCatalogue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always bypasses the HTTP cache, so a just-created tournament is never hidden by a stale response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tournaments: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchTournamentCatalogue();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tournaments",
      expect.objectContaining({ cache: "no-store" })
    );
  });
});
