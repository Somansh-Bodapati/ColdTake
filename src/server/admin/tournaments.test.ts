// POST /api/admin/tournaments — real local Postgres (same DB-backed
// integration pattern as every other src/server/**/*.test.ts, e.g.
// src/server/tournaments/index.test.ts), with the one CricketData network
// hit (series_info) mocked via a stubbed global fetch — never a real call.

import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { team, tournament, user } from "@/lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import handler from "./tournaments";
import seriesInfoFixture from "@/lib/providers/__fixtures__/cricketdata-series-info.json";

const createdUserIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (createdTournamentIds.length > 0) {
    await db.delete(tournament).where(inArray(tournament.id, createdTournamentIds));
    createdTournamentIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function createRequest(rawToken: string | null, body: unknown): Request {
  return new Request("http://localhost/api/admin/tournaments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function stubSeriesInfoFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(seriesInfoFixture), { status: 200, headers: { "content-type": "application/json" } }))
  );
}

describe("POST /api/admin/tournaments", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(createRequest(null, { seriesId: "series-123", seriesName: "Test League 2026" }));
    expect(response.status).toBe(401);
  });

  it("creates a real tournament row and derived team rows from the series_info fixture", async () => {
    vi.stubEnv("CRICKETDATA_API_KEY", "test-key");
    stubSeriesInfoFetch();
    const { userId, session } = await createAnonymousUser(db, "Tournament Creator");
    createdUserIds.push(userId);

    const response = await handler(createRequest(session.rawToken, { seriesId: "series-123", seriesName: "Test League 2026" }));
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      tournament: { id: string; name: string; config: { provider?: string } };
      teamsCreated: number;
    };
    createdTournamentIds.push(body.tournament.id);

    expect(body.tournament.name).toBe("Test League 2026");
    expect(body.tournament.config.provider).toBe("cricketdata");
    expect(body.teamsCreated).toBeGreaterThan(0);

    const [tournamentRow] = await db.select().from(tournament).where(eq(tournament.id, body.tournament.id));
    expect(tournamentRow?.providerKey).toBe("series-123");
    expect(tournamentRow?.sport).toBe("cricket");

    const teamRows = await db.select().from(team).where(eq(team.tournamentId, body.tournament.id));
    expect(teamRows.length).toBe(body.teamsCreated);
    expect(teamRows.some((row) => row.name === "Mumbai Indians" && row.providerKey === "Mumbai Indians")).toBe(true);
  });

  it("returns a 502 (not a crash) when the upstream series_info call fails", async () => {
    vi.stubEnv("CRICKETDATA_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const { userId, session } = await createAnonymousUser(db, "Tournament Creator");
    createdUserIds.push(userId);

    const response = await handler(createRequest(session.rawToken, { seriesId: "series-123", seriesName: "Test League 2026" }));
    expect(response.status).toBe(502);
  });

  it("returns a 400 (not a crash) when the chosen series has no teams", async () => {
    vi.stubEnv("CRICKETDATA_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: "success", data: { matchList: [] }, info: {} }), { status: 200 }))
    );
    const { userId, session } = await createAnonymousUser(db, "Tournament Creator");
    createdUserIds.push(userId);

    const response = await handler(createRequest(session.rawToken, { seriesId: "empty-series", seriesName: "Empty" }));
    expect(response.status).toBe(400);
  });

  it("rejects a malformed request body with 400", async () => {
    vi.stubEnv("CRICKETDATA_API_KEY", "test-key");
    const { userId, session } = await createAnonymousUser(db, "Tournament Creator");
    createdUserIds.push(userId);

    const response = await handler(createRequest(session.rawToken, { seriesId: "" }));
    expect(response.status).toBe(400);
  });
});
