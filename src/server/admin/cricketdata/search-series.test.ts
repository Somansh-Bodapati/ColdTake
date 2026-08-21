// POST /api/admin/cricketdata/search-series — mocks global fetch (there's
// no injectable fetchImpl seam at the route boundary, unlike
// cricketdata-provider.test.ts's constructor injection) so this test never
// makes a real network call to CricketData.

import { afterEach, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { createAnonymousUser, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import handler from "./search-series";

const createdUserIds: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function searchRequest(rawToken: string | null, body: unknown): Request {
  return new Request("http://localhost/api/admin/cricketdata/search-series", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/cricketdata/search-series", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(searchRequest(null, { query: "IPL" }));
    expect(response.status).toBe(401);
  });

  it("rejects a too-short query with 400", async () => {
    vi.stubEnv("CRICKETDATA_API_KEY", "test-key");
    const { userId, session } = await createAnonymousUser(db, "Searcher");
    createdUserIds.push(userId);
    const response = await handler(searchRequest(session.rawToken, { query: "I" }));
    expect(response.status).toBe(400);
  });

  it("returns the matched series on success, without ever hitting real fetch", async () => {
    vi.stubEnv("CRICKETDATA_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "success",
          data: [{ id: "series-1", name: "Indian Premier League 2026", startDate: "2026-03-20", endDate: "2026-05-24" }],
          info: { hitsToday: 1, hitsLimit: 100, offsetRows: 0, totalRows: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { userId, session } = await createAnonymousUser(db, "Searcher");
    createdUserIds.push(userId);

    const response = await handler(searchRequest(session.rawToken, { query: "Indian Premier League" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      series: Array<{ id: string; name: string }>;
      total: number;
      nextOffset: number | null;
    };
    expect(body.series).toEqual([
      { id: "series-1", name: "Indian Premier League 2026", startDate: "2026-03-20", endDate: "2026-05-24", matches: null },
    ]);
    expect(body.total).toBe(1);
    expect(body.nextOffset).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards a non-zero offset to the upstream request, for paging forward", async () => {
    vi.stubEnv("CRICKETDATA_API_KEY", "test-key");
    const fetchMock = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get("offset")).toBe("25");
      return new Response(
        JSON.stringify({ status: "success", data: [], info: { offsetRows: 25, totalRows: 25 } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { userId, session } = await createAnonymousUser(db, "Searcher");
    createdUserIds.push(userId);

    const response = await handler(searchRequest(session.rawToken, { query: "india", offset: 25 }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a 502 (not a crash) when the upstream call fails", async () => {
    vi.stubEnv("CRICKETDATA_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

    const { userId, session } = await createAnonymousUser(db, "Searcher");
    createdUserIds.push(userId);

    const response = await handler(searchRequest(session.rawToken, { query: "IPL" }));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("CricketData search failed");
  });

  it("returns 500 (not a crash) when CRICKETDATA_API_KEY is missing", async () => {
    vi.stubEnv("CRICKETDATA_API_KEY", "");
    const { userId, session } = await createAnonymousUser(db, "Searcher");
    createdUserIds.push(userId);

    const response = await handler(searchRequest(session.rawToken, { query: "IPL" }));
    expect(response.status).toBe(500);
  });
});
