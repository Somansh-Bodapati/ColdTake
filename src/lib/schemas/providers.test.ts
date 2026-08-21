import { describe, expect, it } from "vitest";
import {
  createTournamentFromSeriesRequestSchema,
  searchCricketDataSeriesRequestSchema,
  searchCricketDataSeriesResponseSchema,
} from "./providers";

describe("searchCricketDataSeriesRequestSchema", () => {
  it("accepts a query of at least 2 characters", () => {
    const result = searchCricketDataSeriesRequestSchema.safeParse({ query: "IPL" });
    expect(result.success).toBe(true);
  });

  it("rejects a too-short query", () => {
    const result = searchCricketDataSeriesRequestSchema.safeParse({ query: "I" });
    expect(result.success).toBe(false);
  });

  it("trims whitespace before checking length", () => {
    const result = searchCricketDataSeriesRequestSchema.safeParse({ query: "  a  " });
    expect(result.success).toBe(false);
  });

  it("defaults offset to 0 when omitted (the first page)", () => {
    const result = searchCricketDataSeriesRequestSchema.safeParse({ query: "india" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.offset).toBe(0);
  });

  it("accepts an explicit offset for paging forward", () => {
    const result = searchCricketDataSeriesRequestSchema.safeParse({ query: "india", offset: 25 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.offset).toBe(25);
  });

  it("rejects a negative offset", () => {
    const result = searchCricketDataSeriesRequestSchema.safeParse({ query: "india", offset: -1 });
    expect(result.success).toBe(false);
  });
});

describe("searchCricketDataSeriesResponseSchema", () => {
  it("accepts a list of series with nullable dates/matches, plus pagination info", () => {
    const result = searchCricketDataSeriesResponseSchema.safeParse({
      series: [{ id: "abc", name: "IPL 2026", startDate: null, endDate: null, matches: null }],
      total: 1,
      nextOffset: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a non-null nextOffset when more results remain", () => {
    const result = searchCricketDataSeriesResponseSchema.safeParse({
      series: [],
      total: 97,
      nextOffset: 25,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a series entry missing an id", () => {
    const result = searchCricketDataSeriesResponseSchema.safeParse({
      series: [{ name: "IPL 2026", startDate: null, endDate: null, matches: null }],
      total: 1,
      nextOffset: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("createTournamentFromSeriesRequestSchema", () => {
  it("accepts a seriesId and seriesName", () => {
    const result = createTournamentFromSeriesRequestSchema.safeParse({
      seriesId: "series-123",
      seriesName: "Indian Premier League 2026",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty seriesId", () => {
    const result = createTournamentFromSeriesRequestSchema.safeParse({ seriesId: "", seriesName: "IPL 2026" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing seriesName", () => {
    const result = createTournamentFromSeriesRequestSchema.safeParse({ seriesId: "series-123" });
    expect(result.success).toBe(false);
  });
});
