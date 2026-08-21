// CricketDataProvider — rewritten this session against the REAL, verified
// api.cricapi.com v1 response shape (docs/DECISIONS.md has the captured
// evidence; cricketdata-dto.ts's header explains what changed from Session
// 11's guessed shape). Proves it satisfies the StandingsProvider contract
// exactly like ManualProvider, entirely from recorded fixture JSON fed
// through an injected `fetchImpl`. No test in this file makes a real network
// call — `fetchImpl` never falls through to the real global `fetch`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { team, tournament } from "@/lib/db/schema";
import { CricketDataProvider, ProviderFetchError, type FetchLike } from "@/lib/providers/cricketdata-provider";
import { ProviderUnsupportedError } from "@/lib/providers/types";
import { insertTestTournament } from "@/lib/seasons/test-support";
import seriesInfoFixture from "@/lib/providers/__fixtures__/cricketdata-series-info.json";
import seriesInfoHighUsageFixture from "@/lib/providers/__fixtures__/cricketdata-series-info-high-usage.json";
import seriesInfoMissingFieldsFixture from "@/lib/providers/__fixtures__/cricketdata-series-info-missing-fields.json";

const createdTournamentIds: string[] = [];

afterEach(async () => {
  if (createdTournamentIds.length > 0) {
    await db.delete(tournament).where(inArray(tournament.id, createdTournamentIds));
    createdTournamentIds.length = 0;
  }
  vi.restoreAllMocks();
});

// A fetchImpl that serves fixture JSON keyed by which endpoint path was
// requested — stands in for the real network entirely; nothing here ever
// calls global fetch.
function fixtureFetch(byPath: Record<string, unknown>): FetchLike {
  return async (input: string) => {
    const path = new URL(input).pathname;
    const body = byPath[path];
    if (body === undefined) {
      throw new Error(`fixtureFetch: no fixture registered for path ${path}`);
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
}

async function insertTeams(tournamentId: string): Promise<{ mi: string; csk: string }> {
  const mi = `${tournamentId}-mi`;
  const csk = `${tournamentId}-csk`;
  await db.insert(team).values([
    { id: mi, tournamentId, name: "Mumbai Indians", shortName: "MI" },
    { id: csk, tournamentId, name: "Chennai Super Kings", shortName: "CSK" },
  ]);
  return { mi, csk };
}

describe("CricketDataProvider", () => {
  it("reports its source as 'cricketdata'", () => {
    expect(new CricketDataProvider(db, { apiKey: "test-key" }).source).toBe("cricketdata");
  });

  it("computes the table from series_info's matchList: wins (any case), a no-result, and excludes in-progress/upcoming matches", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });
    const { mi, csk } = await insertTeams(tournamentId);

    const provider = new CricketDataProvider(db, {
      apiKey: "test-key",
      fetchImpl: fixtureFetch({ "/v1/series_info": seriesInfoFixture }),
    });

    const table = await provider.getTable(tournamentId);

    // Fixture has 5 matches: MI win ("Mumbai Indians won by 7 wkts"), a CSK
    // win with the winner's name in a different case than `teams`
    // ("chennai super kings won by 5 runs"), a tie ("Match tied", 1 point
    // each), an in-progress match (matchEnded: false), and an upcoming
    // match (matchEnded: false) — only the first three count.
    expect(table).toEqual([
      { teamId: mi, played: 3, won: 1, lost: 1, points: 3, nrr: 0, position: 1 },
      { teamId: csk, played: 3, won: 1, lost: 1, points: 3, nrr: 0, position: 2 },
    ]);
  });

  it("logs a usage warning once daily API usage crosses 80% of the free-tier limit", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });
    await insertTeams(tournamentId);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = new CricketDataProvider(db, {
      apiKey: "test-key",
      fetchImpl: fixtureFetch({ "/v1/series_info": seriesInfoHighUsageFixture }),
    });
    await provider.getTable(tournamentId);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("85/100"));
  });

  it("does not log a usage warning below 80% of the free-tier limit", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });
    await insertTeams(tournamentId);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const provider = new CricketDataProvider(db, {
      apiKey: "test-key",
      fetchImpl: fixtureFetch({ "/v1/series_info": seriesInfoFixture }), // hitsToday: 7, hitsLimit: 100
    });
    await provider.getTable(tournamentId);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("getStatLeaders always returns [] — this tier has no player-level stats, by design, not by failure", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });

    const provider = new CricketDataProvider(db, { apiKey: "test-key" });

    await expect(provider.getStatLeaders(tournamentId, "runs")).resolves.toEqual([]);
  });

  it("getFinalResult always throws ProviderUnsupportedError — champion determination requires manual settlement", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });

    const provider = new CricketDataProvider(db, { apiKey: "test-key" });

    await expect(provider.getFinalResult(tournamentId)).rejects.toThrow(ProviderUnsupportedError);
  });

  // Failure handling: all three of these prove CricketDataProvider throws
  // ProviderFetchError rather than returning bad data — ingest.ts (tested
  // separately in ingest-provider-failure.test.ts) is what turns this into
  // "keep serving the last good live_state."

  it("throws ProviderFetchError on a request that times out", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });

    const neverResolvingFetch: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });

    const provider = new CricketDataProvider(db, {
      apiKey: "test-key",
      fetchImpl: neverResolvingFetch,
      timeoutMs: 10,
    });

    await expect(provider.getTable(tournamentId)).rejects.toThrow(ProviderFetchError);
  });

  it("throws ProviderFetchError on a response body that isn't valid JSON", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });

    const malformedJsonFetch: FetchLike = async () =>
      new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } });

    const provider = new CricketDataProvider(db, { apiKey: "test-key", fetchImpl: malformedJsonFetch });

    await expect(provider.getTable(tournamentId)).rejects.toThrow(ProviderFetchError);
  });

  it("throws ProviderFetchError on a response missing fields the mapping needs", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });
    await insertTeams(tournamentId);

    const provider = new CricketDataProvider(db, {
      apiKey: "test-key",
      fetchImpl: fixtureFetch({ "/v1/series_info": seriesInfoMissingFieldsFixture }),
    });

    await expect(provider.getTable(tournamentId)).rejects.toThrow(ProviderFetchError);
  });
});
