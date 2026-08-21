// CricketDataProvider (this session's brief, task 1) — proves it satisfies
// the StandingsProvider contract exactly like ManualProvider (same shapes,
// per manual-provider.test.ts), and does it entirely from recorded fixture
// JSON fed through an injected `fetchImpl`. No test in this file, or
// anywhere in this session, makes a real network call (this session's
// brief, task 2/6) — `fetchImpl` never falls through to the real global
// `fetch`.

import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { player, team, tournament } from "@/lib/db/schema";
import { CricketDataProvider, ProviderFetchError, type FetchLike } from "@/lib/providers/cricketdata-provider";
import { insertTestTournament } from "@/lib/seasons/test-support";
import seriesPointsFixture from "@/lib/providers/__fixtures__/cricketdata-series-points.json";
import seriesPointsMissingFieldsFixture from "@/lib/providers/__fixtures__/cricketdata-series-points-missing-fields.json";
import statsRunsFixture from "@/lib/providers/__fixtures__/cricketdata-stats-runs.json";
import seriesInfoFixture from "@/lib/providers/__fixtures__/cricketdata-series-info.json";

const createdTournamentIds: string[] = [];

afterEach(async () => {
  if (createdTournamentIds.length > 0) {
    await db.delete(tournament).where(inArray(tournament.id, createdTournamentIds));
    createdTournamentIds.length = 0;
  }
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

async function insertTeams(tournamentId: string): Promise<void> {
  await db.insert(team).values([
    { id: `${tournamentId}-mi`, tournamentId, name: "Mumbai Indians", shortName: "MI", providerKey: "cricketdata-mi" },
    {
      id: `${tournamentId}-csk`,
      tournamentId,
      name: "Chennai Super Kings",
      shortName: "CSK",
      providerKey: "cricketdata-csk",
    },
  ]);
}

async function insertPlayers(tournamentId: string): Promise<void> {
  await db.insert(player).values([
    { id: `${tournamentId}-rohit`, tournamentId, name: "Rohit Sharma", providerKey: "cricketdata-player-1" },
    { id: `${tournamentId}-ruturaj`, tournamentId, name: "Ruturaj Gaikwad", providerKey: "cricketdata-player-2" },
  ]);
}

describe("CricketDataProvider", () => {
  it("reports its source as 'cricketdata'", () => {
    expect(new CricketDataProvider(db, { apiKey: "test-key" }).source).toBe("cricketdata");
  });

  it("maps a fixture series_points response into TeamStanding[], resolving CricketData's team ids to ours", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });
    await insertTeams(tournamentId);

    const provider = new CricketDataProvider(db, {
      apiKey: "test-key",
      fetchImpl: fixtureFetch({ "/v1/series_points": seriesPointsFixture }),
    });

    const table = await provider.getTable(tournamentId);
    expect(table).toEqual([
      { teamId: `${tournamentId}-mi`, played: 5, won: 4, lost: 1, points: 8, nrr: 0.55, position: 1 },
      { teamId: `${tournamentId}-csk`, played: 5, won: 3, lost: 2, points: 6, nrr: 0.21, position: 2 },
    ]);
  });

  it("maps a fixture stats response into PlayerStat[], resolving CricketData's player ids to ours", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });
    await insertPlayers(tournamentId);

    const provider = new CricketDataProvider(db, {
      apiKey: "test-key",
      fetchImpl: fixtureFetch({ "/v1/stats/runs": statsRunsFixture }),
    });

    const stats = await provider.getStatLeaders(tournamentId, "runs");
    expect(stats).toEqual([
      { playerId: `${tournamentId}-rohit`, value: 312 },
      { playerId: `${tournamentId}-ruturaj`, value: 289 },
    ]);
  });

  it("maps a fixture series_info response into a TournamentResult from the final's winner", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });
    await insertTeams(tournamentId);

    const provider = new CricketDataProvider(db, {
      apiKey: "test-key",
      fetchImpl: fixtureFetch({ "/v1/series_info": seriesInfoFixture }),
    });

    const result = await provider.getFinalResult(tournamentId);
    expect(result).toEqual({ championTeamId: `${tournamentId}-mi` });
  });

  // Failure handling (this session's brief, task 3): all three of these
  // prove CricketDataProvider throws ProviderFetchError rather than
  // returning bad data — ingest.ts (tested separately in
  // ingest-provider-failure.test.ts) is what turns this into "keep serving
  // the last good live_state."

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
      fetchImpl: fixtureFetch({ "/v1/series_points": seriesPointsMissingFieldsFixture }),
    });

    await expect(provider.getTable(tournamentId)).rejects.toThrow(ProviderFetchError);
  });
});
