import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../../lib/db/client";
import { user } from "../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../lib/auth/session";
import handler from "./anonymous";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/anonymous", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/anonymous", () => {
  it("creates a user, sets a session cookie, and returns the token", async () => {
    const response = await handler(postRequest({ displayName: "Rahul" }));
    expect(response.status).toBe(201);

    const body = (await response.json()) as { userId: string; sessionToken: string };
    createdUserIds.push(body.userId);
    expect(body.userId).toBeTruthy();
    expect(body.sessionToken).toBeTruthy();

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");

    // Regression test for the production bug (Session 16): a `Path`
    // narrower than `/` (or absent, which browsers default to the
    // *directory* of the request that set it — here that would be
    // "/api/auth", not "/") means the cookie stops being sent on any route
    // outside that prefix, which looks exactly like "worked once, then
    // silently vanished on the next page load". Must be an exact `Path=/`
    // segment, not merely a header that happens to contain that substring
    // (a wrong `Path=/api/auth` also contains the text "Path=/").
    expect(setCookie?.split(";").map((s) => s.trim())).toContain("Path=/");
    expect(setCookie).toContain("SameSite=Lax");
    // Must carry a real expiry far in the future, not be a bare session
    // cookie with none at all.
    const expiresMatch = setCookie?.match(/Expires=([^;]+)/);
    expect(expiresMatch).toBeTruthy();
    const daysUntilExpiry =
      (new Date(String(expiresMatch?.[1])).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilExpiry).toBeGreaterThan(25);
  });

  it("rejects an empty display name with 400", async () => {
    const response = await handler(postRequest({ displayName: "" }));
    expect(response.status).toBe(400);
  });

  it("rejects a non-POST method with 405", async () => {
    const response = await handler(new Request("http://localhost/api/auth/anonymous"));
    expect(response.status).toBe(405);
  });
});
