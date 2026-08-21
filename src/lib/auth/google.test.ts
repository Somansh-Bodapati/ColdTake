// Integration tests against the local Postgres, same pattern as
// session.test.ts — find-or-create/link touches the real `user` table. The
// token-exchange and userinfo-fetch legs are exercised with an injected
// `FetchLike` (same pattern as cricketdata-provider.test.ts) — nothing here
// makes a real call to Google.

import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";
import { createId } from "@/lib/db/id";
import { createAnonymousUser, requireUser, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import {
  GOOGLE_STATE_COOKIE_NAME,
  buildStateCookie,
  buildClearStateCookie,
  verifyState,
  googleAuthorizationUrl,
  generateState,
  exchangeCodeForToken,
  fetchGoogleProfile,
  findOrCreateGoogleUser,
  needsNamePrompt,
  confirmDisplayName,
  type FetchLike,
  type GoogleProfile,
} from "@/lib/auth/google";
import { AppError } from "@/lib/errors";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function profile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    sub: `google-${createId()}`,
    email: `user-${createId()}@example.com`,
    email_verified: true,
    name: "Rahul Sharma",
    given_name: "Rahul",
    ...overrides,
  };
}

describe("googleAuthorizationUrl", () => {
  it("builds the authorize URL with client_id, redirect_uri, scope, and state", () => {
    const url = new URL(googleAuthorizationUrl("test-state-value"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${process.env.APP_URL ?? "http://localhost:5173"}/api/auth/google/callback`
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("test-state-value");
  });
});

describe("generateState", () => {
  it("produces a distinct value each call", () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe("state cookie CSRF protection", () => {
  function requestWithStateCookie(cookieValue: string | null): Request {
    return new Request("http://localhost/api/auth/google/callback", {
      headers: cookieValue ? { cookie: `${GOOGLE_STATE_COOKIE_NAME}=${cookieValue}` } : {},
    });
  }

  it("accepts a state param that matches the cookie set for it", () => {
    const rawState = generateState();
    const setCookieHeader = buildStateCookie(rawState);
    const [nameValuePair] = setCookieHeader.split(";");
    const cookieValue = nameValuePair.split("=").slice(1).join("=");

    expect(() => verifyState(requestWithStateCookie(cookieValue), rawState)).not.toThrow();
  });

  it("rejects when there is no state cookie at all", () => {
    expect(() => verifyState(requestWithStateCookie(null), "some-state")).toThrow(AppError);
  });

  it("rejects when the state param is missing", () => {
    const rawState = generateState();
    const setCookieHeader = buildStateCookie(rawState);
    const cookieValue = setCookieHeader.split(";")[0].split("=").slice(1).join("=");
    expect(() => verifyState(requestWithStateCookie(cookieValue), null)).toThrow(AppError);
  });

  it("rejects a state param that doesn't match the cookie (forged/replayed state)", () => {
    const rawState = generateState();
    const setCookieHeader = buildStateCookie(rawState);
    const cookieValue = setCookieHeader.split(";")[0].split("=").slice(1).join("=");

    expect(() => verifyState(requestWithStateCookie(cookieValue), "attacker-supplied-state")).toThrow(
      AppError
    );
  });

  it("builds a clearing cookie that expires immediately", () => {
    expect(buildClearStateCookie()).toContain("Max-Age=0");
  });
});

describe("exchangeCodeForToken", () => {
  it("posts the expected params and returns the access token", async () => {
    let capturedBody = "";
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ access_token: "at-123", token_type: "Bearer", expires_in: 3600 }), {
        status: 200,
      });
    };

    const token = await exchangeCodeForToken(fetchImpl, "auth-code-abc");
    expect(token).toBe("at-123");

    const params = new URLSearchParams(capturedBody);
    expect(params.get("code")).toBe("auth-code-abc");
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(
      `${process.env.APP_URL ?? "http://localhost:5173"}/api/auth/google/callback`
    );
  });

  it("throws AppError when Google responds with a non-OK status", async () => {
    const fetchImpl: FetchLike = async () => new Response("bad code", { status: 400 });
    await expect(exchangeCodeForToken(fetchImpl, "bad-code")).rejects.toThrow(AppError);
  });
});

describe("fetchGoogleProfile", () => {
  it("sends the bearer token and returns the parsed profile", async () => {
    let capturedAuth: string | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedAuth = (init?.headers as Record<string, string> | undefined)?.authorization ?? null;
      return new Response(JSON.stringify(profile({ sub: "abc123" })), { status: 200 });
    };

    const result = await fetchGoogleProfile(fetchImpl, "at-123");
    expect(capturedAuth).toBe("Bearer at-123");
    expect(result.sub).toBe("abc123");
  });

  it("throws AppError on a non-OK response", async () => {
    const fetchImpl: FetchLike = async () => new Response("nope", { status: 401 });
    await expect(fetchGoogleProfile(fetchImpl, "bad-token")).rejects.toThrow(AppError);
  });
});

describe("findOrCreateGoogleUser", () => {
  it("creates a brand-new user seeded with a placeholder name, unconfirmed", async () => {
    const result = await findOrCreateGoogleUser(db, profile({ given_name: "Meera" }));
    createdUserIds.push(result.userId);

    expect(result.isNewUser).toBe(true);
    expect(result.displayNameConfirmedAt).toBeNull();
    expect(needsNamePrompt(result.displayNameConfirmedAt)).toBe(true);

    const [row] = await db.select().from(user).where(eq(user.id, result.userId)).limit(1);
    expect(row?.displayName).toBe("Meera");
    expect(row?.googleId).toBeTruthy();

    const found = await requireUser(
      db,
      new Request("http://localhost/api/me", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${result.session.rawToken}` },
      })
    );
    expect(found.id).toBe(result.userId);
  });

  it("falls back to the profile's full name when given_name is absent", async () => {
    const result = await findOrCreateGoogleUser(db, profile({ given_name: undefined, name: "Full Name" }));
    createdUserIds.push(result.userId);
    const [row] = await db.select().from(user).where(eq(user.id, result.userId)).limit(1);
    expect(row?.displayName).toBe("Full Name");
  });

  it("logs an existing Google-linked user back in without creating a duplicate", async () => {
    const p = profile();
    const first = await findOrCreateGoogleUser(db, p);
    createdUserIds.push(first.userId);

    const second = await findOrCreateGoogleUser(db, p);
    expect(second.userId).toBe(first.userId);
    expect(second.isNewUser).toBe(false);

    const rows = await db.select().from(user).where(eq(user.googleId, p.sub));
    expect(rows).toHaveLength(1);
  });

  it("links googleId onto an existing account matched by verified email instead of duplicating it", async () => {
    const email = `linkme-${createId()}@example.com`;
    const { userId } = await createAnonymousUser(db, "Existing Name");
    createdUserIds.push(userId);
    await db.update(user).set({ email }).where(eq(user.id, userId));

    const googleProfile = profile({ email, email_verified: true });
    const result = await findOrCreateGoogleUser(db, googleProfile);

    expect(result.userId).toBe(userId);
    expect(result.isNewUser).toBe(false);
    // Already had a real, self-chosen name -> the one-time prompt must not
    // fire for this account.
    expect(needsNamePrompt(result.displayNameConfirmedAt)).toBe(false);

    const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    expect(row?.googleId).toBe(googleProfile.sub);
    expect(row?.displayName).toBe("Existing Name"); // untouched
  });

  it("does not link by email when Google reports the email as unverified", async () => {
    const email = `unverified-${createId()}@example.com`;
    const { userId: existingId } = await createAnonymousUser(db, "Has This Email");
    createdUserIds.push(existingId);
    await db.update(user).set({ email }).where(eq(user.id, existingId));

    const result = await findOrCreateGoogleUser(db, profile({ email, email_verified: false }));
    createdUserIds.push(result.userId);

    expect(result.userId).not.toBe(existingId);
    expect(result.isNewUser).toBe(true);
  });
});

describe("needsNamePrompt", () => {
  it("is true when displayNameConfirmedAt is null (brand-new Google user)", () => {
    expect(needsNamePrompt(null)).toBe(true);
  });

  it("is false once displayNameConfirmedAt is set (returning user, or one-time prompt completed)", () => {
    expect(needsNamePrompt(new Date())).toBe(false);
  });
});

describe("confirmDisplayName", () => {
  it("sets the display name and marks the prompt confirmed", async () => {
    const result = await findOrCreateGoogleUser(db, profile({ given_name: "Placeholder" }));
    createdUserIds.push(result.userId);
    expect(needsNamePrompt(result.displayNameConfirmedAt)).toBe(true);

    await confirmDisplayName(db, result.userId, "Real Name");

    const [row] = await db.select().from(user).where(eq(user.id, result.userId)).limit(1);
    expect(row?.displayName).toBe("Real Name");
    expect(row?.displayNameConfirmedAt).not.toBeNull();
    expect(needsNamePrompt(row?.displayNameConfirmedAt ?? null)).toBe(false);
  });
});
