// Tests for the admin tournament-creation flow's CricketData plumbing
// (cricketdata-admin.ts) — same "inject fetchImpl, never call real fetch"
// pattern as cricketdata-provider.test.ts. createTournamentFromCricketDataSeries
// hits real local Postgres (same pattern as every other DB-backed test in
// this codebase, e.g. seasons/test-support.ts's fixtures) but its one
// "network" call is always the injected fetchImpl serving fixture JSON.

import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { team, tournament } from "@/lib/db/schema";
import {
  CricketDataAdminFetchError,
  createTournamentFromCricketDataSeries,
  deriveShortName,
  deriveTeamNamesFromMatchList,
  fetchCricketDataSeriesInfo,
  parseSeriesDate,
  searchCricketDataSeries,
  type FetchLike,
} from "@/lib/providers/cricketdata-admin";
import { AppError } from "@/lib/errors";
import seriesInfoFixture from "@/lib/providers/__fixtures__/cricketdata-series-info.json";

const createdTournamentIds: string[] = [];

afterEach(async () => {
  if (createdTournamentIds.length > 0) {
    await db.delete(tournament).where(inArray(tournament.id, createdTournamentIds));
    createdTournamentIds.length = 0;
  }
});

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

describe("searchCricketDataSeries", () => {
  it("returns the matched series list from /v1/series", async () => {
    const fetchImpl = fixtureFetch({
      "/v1/series": {
        status: "success",
        data: [{ id: "series-1", name: "Indian Premier League 2026", startDate: "2026-03-20", endDate: "2026-05-24" }],
        info: { hitsToday: 1, hitsLimit: 100 },
      },
    });
    const results = await searchCricketDataSeries({ apiKey: "test-key", fetchImpl }, "Indian Premier League");
    expect(results).toEqual([
      { id: "series-1", name: "Indian Premier League 2026", startDate: "2026-03-20", endDate: "2026-05-24" },
    ]);
  });

  it("throws CricketDataAdminFetchError on a non-OK HTTP response", async () => {
    const fetchImpl: FetchLike = async () => new Response("", { status: 500 });
    await expect(searchCricketDataSeries({ apiKey: "test-key", fetchImpl }, "IPL")).rejects.toBeInstanceOf(
      CricketDataAdminFetchError
    );
  });

  it("throws CricketDataAdminFetchError on malformed (non-JSON) response", async () => {
    const fetchImpl: FetchLike = async () => new Response("not json", { status: 200 });
    await expect(searchCricketDataSeries({ apiKey: "test-key", fetchImpl }, "IPL")).rejects.toBeInstanceOf(
      CricketDataAdminFetchError
    );
  });

  it("throws CricketDataAdminFetchError on the API's own failure envelope", async () => {
    const fetchImpl = fixtureFetch({ "/v1/series": { status: "failure", reason: "Invalid API key", data: [] } });
    await expect(searchCricketDataSeries({ apiKey: "bad-key", fetchImpl }, "IPL")).rejects.toBeInstanceOf(
      CricketDataAdminFetchError
    );
  });
});

describe("deriveTeamNamesFromMatchList", () => {
  it("dedupes team names case-insensitively across every match", () => {
    const names = deriveTeamNamesFromMatchList([
      { id: "m1", status: "x", teams: ["Mumbai Indians", "Chennai Super Kings"], matchStarted: true, matchEnded: true },
      { id: "m2", status: "x", teams: ["chennai super kings", "Mumbai Indians"], matchStarted: true, matchEnded: true },
      { id: "m3", status: "x", teams: ["Royal Challengers Bengaluru", "Mumbai Indians"], matchStarted: false, matchEnded: false },
    ]);
    expect(names).toEqual(["Mumbai Indians", "Chennai Super Kings", "Royal Challengers Bengaluru"]);
  });

  it("returns an empty array for an empty match list", () => {
    expect(deriveTeamNamesFromMatchList([])).toEqual([]);
  });
});

describe("deriveShortName", () => {
  it("uses initials for a multi-word name", () => {
    expect(deriveShortName("Mumbai Indians")).toBe("MI");
    expect(deriveShortName("Royal Challengers Bengaluru")).toBe("RCB");
  });

  it("uses the first 3 letters for a single-word name", () => {
    expect(deriveShortName("Gladiators")).toBe("GLA");
  });
});

describe("parseSeriesDate", () => {
  it("parses a valid ISO-ish date string", () => {
    const parsed = parseSeriesDate("2026-03-20");
    expect(parsed).not.toBeNull();
    expect(parsed?.getUTCFullYear()).toBe(2026);
  });

  it("returns null for outright garbage", () => {
    expect(parseSeriesDate("not-a-date")).toBeNull();
  });

  // Regression: a real live series_info response for IPL 2026 returned
  // enddate "May 31" (no year) — `new Date("May 31")` doesn't throw, it
  // silently assumes a fixed reference year (observed: 2001), which would
  // have persisted a wildly wrong endsAt with no signal anything was wrong.
  it("returns null for a year-less month/day string CricketData sometimes sends", () => {
    expect(parseSeriesDate("May 31")).toBeNull();
    expect(parseSeriesDate("Sep 13")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseSeriesDate(undefined)).toBeNull();
  });
});

describe("fetchCricketDataSeriesInfo", () => {
  it("returns the parsed series_info response", async () => {
    const fetchImpl = fixtureFetch({ "/v1/series_info": seriesInfoFixture });
    const response = await fetchCricketDataSeriesInfo({ apiKey: "test-key", fetchImpl }, "series-123");
    expect(response.status).toBe("success");
    expect(response.data?.matchList.length).toBeGreaterThan(0);
  });
});

describe("createTournamentFromCricketDataSeries", () => {
  it("creates a tournament row and derived team rows with providerKey set to the team's CricketData name", async () => {
    const fetchImpl = fixtureFetch({ "/v1/series_info": seriesInfoFixture });

    const result = await createTournamentFromCricketDataSeries(
      db,
      { apiKey: "test-key", fetchImpl },
      { seriesId: "series-123", seriesName: "Test League 2026" }
    );
    createdTournamentIds.push(result.tournamentId);

    expect(result.teamsCreated).toBeGreaterThan(0);

    const [tournamentRow] = await db.select().from(tournament).where(eq(tournament.id, result.tournamentId));
    expect(tournamentRow?.name).toBe("Test League 2026");
    expect(tournamentRow?.providerKey).toBe("series-123");
    expect(tournamentRow?.config.provider).toBe("cricketdata");
    expect(tournamentRow?.teamCount).toBe(result.teamsCreated);

    const teamRows = await db.select().from(team).where(eq(team.tournamentId, result.tournamentId));
    expect(teamRows.length).toBe(result.teamsCreated);
    const teamNames = teamRows.map((row) => row.name).sort();
    expect(teamNames).toContain("Mumbai Indians");
    expect(teamNames).toContain("Chennai Super Kings");
    for (const row of teamRows) {
      // providerKey is the team's CricketData name verbatim — this is
      // exactly what CricketDataProvider's case-insensitive name matching
      // (loadTeamNames in cricketdata-provider.ts) keys off.
      expect(row.providerKey).toBe(row.name);
    }
  });

  it("throws AppError(400) when the series has no teams in its match list", async () => {
    const fetchImpl = fixtureFetch({
      "/v1/series_info": { status: "success", data: { matchList: [] }, info: {} },
    });
    await expect(
      createTournamentFromCricketDataSeries(db, { apiKey: "test-key", fetchImpl }, { seriesId: "empty-series", seriesName: "Empty" })
    ).rejects.toBeInstanceOf(AppError);
  });

  it("propagates CricketDataAdminFetchError when series_info fails", async () => {
    const fetchImpl: FetchLike = async () => new Response("", { status: 500 });
    await expect(
      createTournamentFromCricketDataSeries(db, { apiKey: "test-key", fetchImpl }, { seriesId: "series-123", seriesName: "X" })
    ).rejects.toBeInstanceOf(CricketDataAdminFetchError);
  });
});
