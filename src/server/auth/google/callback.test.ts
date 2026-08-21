// GET /api/auth/google/callback — mocks global fetch (no injectable seam at
// the route boundary, same reasoning as
// src/server/admin/cricketdata/search-series.test.ts) so this never makes a
// real call to Google. Exercises the full find-or-create path against the
// real local Postgres, with only the two Google HTTP calls faked.

import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { createId } from "@/lib/db/id";
import { buildStateCookie } from "@/lib/auth/google";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import handler from "./callback";

const createdUserIds: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function stubGoogleFetch(profileOverrides: Record<string, unknown> = {}): void {
  const fetchMock = vi.fn(async (input: string) => {
    if (String(input).includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({ access_token: "at-123", token_type: "Bearer", expires_in: 3600 }),
        { status: 200 }
      );
    }
    if (String(input).includes("googleapis.com/oauth2/v3/userinfo")) {
      return new Response(
        JSON.stringify({
          sub: `google-${createId()}`,
          email: `cb-${createId()}@example.com`,
          email_verified: true,
          name: "Callback User",
          given_name: "Callback",
          ...profileOverrides,
        }),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected fetch to ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

// Builds a callback request carrying both the state query param and the
// matching state cookie the authorize step would have set.
function callbackRequest(params: { code?: string; state?: string; error?: string }): {
  request: Request;
  rawState: string;
} {
  const rawState = params.state ?? "test-state-value";
  const url = new URL("http://localhost/api/auth/google/callback");
  if (params.code) url.searchParams.set("code", params.code);
  if (params.state !== undefined || params.code) url.searchParams.set("state", rawState);
  if (params.error) url.searchParams.set("error", params.error);

  const setCookie = buildStateCookie(rawState);
  const cookiePair = setCookie.split(";")[0];

  return { request: new Request(url, { headers: { cookie: cookiePair } }), rawState };
}

// Two Set-Cookie headers are set on a successful callback (session + clear
// the oauth state cookie) — Headers.get("set-cookie") only ever returns one
// of them (or null, depending on the runtime's fetch implementation) per the
// Fetch spec's special-casing of that header; getSetCookie() is the correct
// way to read all of them back out.
function findSessionCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!cookie) {
    throw new Error("No session cookie was set");
  }
  return cookie;
}

async function extractUserIdFromSetCookie(response: Response): Promise<string> {
  const setCookie = findSessionCookie(response);
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookie);
  const rawToken = decodeURIComponent(String(match?.[1]));
  const { requireUser } = await import("@/lib/auth/session");
  const found = await requireUser(
    db,
    new Request("http://localhost/api/me", { headers: { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } })
  );
  return found.id;
}

describe("GET /api/auth/google/callback", () => {
  it("rejects a missing state cookie (CSRF check)", async () => {
    const response = await handler(
      new Request("http://localhost/api/auth/google/callback?code=abc&state=xyz")
    );
    expect(response.status).toBe(400);
  });

  it("rejects a state param that doesn't match the cookie", async () => {
    const { request } = callbackRequest({ code: "abc", state: "correct-state" });
    const tampered = new Request(
      request.url.replace("state=correct-state", "state=attacker-state"),
      { headers: request.headers }
    );
    const response = await handler(tampered);
    expect(response.status).toBe(400);
  });

  it("redirects back to the entry screen when Google reports an error (consent declined)", async () => {
    const { request } = callbackRequest({ error: "access_denied" });
    const response = await handler(request);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("google_error=1");
  });

  it("creates a brand-new user, sets a session cookie, and redirects with ?welcome=1", async () => {
    stubGoogleFetch();
    const { request } = callbackRequest({ code: "auth-code" });

    const response = await handler(request);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("welcome=1");

    expect(findSessionCookie(response)).toContain(`${SESSION_COOKIE_NAME}=`);

    const userId = await extractUserIdFromSetCookie(response);
    createdUserIds.push(userId);
    const [row] = await db.select().from(user).where(eq(user.id, userId));
    expect(row?.displayName).toBe("Callback");
    expect(row?.displayNameConfirmedAt).toBeNull();
  });

  it("logs a returning Google user in without the welcome prompt, once the name is already confirmed", async () => {
    stubGoogleFetch({ sub: "returning-google-id" });
    const first = await handler(callbackRequest({ code: "auth-code-1" }).request);
    const firstUserId = await extractUserIdFromSetCookie(first);
    createdUserIds.push(firstUserId);
    // Simulates completing the one-time name prompt after the first sign-in.
    await db.update(user).set({ displayNameConfirmedAt: new Date() }).where(eq(user.id, firstUserId));

    stubGoogleFetch({ sub: "returning-google-id" });
    const second = await handler(callbackRequest({ code: "auth-code-2" }).request);
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).not.toContain("welcome=1");
    const secondUserId = await extractUserIdFromSetCookie(second);
    expect(secondUserId).toBe(firstUserId);
  });

  it("still prompts a Google user who signed out before ever confirming a name", async () => {
    stubGoogleFetch({ sub: "never-confirmed-google-id" });
    const first = await handler(callbackRequest({ code: "auth-code-1" }).request);
    const firstUserId = await extractUserIdFromSetCookie(first);
    createdUserIds.push(firstUserId);

    stubGoogleFetch({ sub: "never-confirmed-google-id" });
    const second = await handler(callbackRequest({ code: "auth-code-2" }).request);
    expect(second.headers.get("location")).toContain("welcome=1");
  });

  it("rejects a non-GET method with 405", async () => {
    const response = await handler(
      new Request("http://localhost/api/auth/google/callback", { method: "POST" })
    );
    expect(response.status).toBe(405);
  });
});
