// Integration tests against the local Postgres (docker-compose.yml /
// Homebrew postgres@16, DATABASE_URL from .env) — session.ts is the
// DB-touching half of auth, so it's tested against a real database rather
// than mocked, per this session's brief (task 7).

import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authToken, user } from "@/lib/db/schema";
import { createId } from "@/lib/db/id";
import {
  createAnonymousUser,
  createClaimToken,
  createSessionForUser,
  requireUser,
  revokeSession,
  verifyMagicLinkToken,
  buildSessionCookie,
  buildLogoutCookie,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

function cookieRequest(rawToken: string | null): Request {
  return new Request("http://localhost/api/me", {
    headers: rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {},
  });
}

describe("createAnonymousUser + requireUser", () => {
  it("creates a user and a session that requireUser accepts", async () => {
    const { userId, session } = await createAnonymousUser(db, "Priya");
    createdUserIds.push(userId);

    const found = await requireUser(db, cookieRequest(session.rawToken));
    expect(found.id).toBe(userId);
    expect(found.displayName).toBe("Priya");
    expect(found.email).toBeNull();
    expect(found.claimedAt).toBeNull();
  });

  it("rejects a request with no cookie", async () => {
    await expect(requireUser(db, cookieRequest(null))).rejects.toThrow(AppError);
  });

  it("rejects an unknown token", async () => {
    await expect(requireUser(db, cookieRequest("not-a-real-token"))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects an expired session", async () => {
    const { userId } = await createAnonymousUser(db, "Expired User");
    createdUserIds.push(userId);

    // Manually insert an already-expired session token — createSessionForUser
    // always issues a live one, so exercise the expiry check directly.
    const { hashToken, generateRawToken } = await import("@/lib/auth/tokens");
    const rawToken = generateRawToken();
    await db.insert(authToken).values({
      id: createId(),
      userId,
      tokenHash: hashToken(rawToken),
      purpose: "session",
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(requireUser(db, cookieRequest(rawToken))).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("revokeSession", () => {
  it("makes a previously-valid session token rejected afterwards", async () => {
    const { userId, session } = await createAnonymousUser(db, "Logs Out");
    createdUserIds.push(userId);

    await requireUser(db, cookieRequest(session.rawToken)); // valid before logout
    await revokeSession(db, cookieRequest(session.rawToken));

    await expect(requireUser(db, cookieRequest(session.rawToken))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("is a no-op when there is no session cookie", async () => {
    await expect(revokeSession(db, cookieRequest(null))).resolves.toBeUndefined();
  });
});

describe("createClaimToken + verifyMagicLinkToken", () => {
  it("attaches the pending email and claimedAt on verify", async () => {
    const { userId } = await createAnonymousUser(db, "Claiming User");
    createdUserIds.push(userId);
    const email = `claim-${createId()}@example.com`;

    const claim = await createClaimToken(db, userId, email);
    const result = await verifyMagicLinkToken(db, claim.rawToken);
    expect(result.userId).toBe(userId);

    const [row] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    expect(row?.email).toBe(email);
    expect(row?.claimedAt).not.toBeNull();
  });

  it("is single-use: a second verify of the same token fails", async () => {
    const { userId } = await createAnonymousUser(db, "Single Use");
    createdUserIds.push(userId);
    const claim = await createClaimToken(db, userId, `single-${createId()}@example.com`);

    await verifyMagicLinkToken(db, claim.rawToken);
    await expect(verifyMagicLinkToken(db, claim.rawToken)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an unknown token", async () => {
    await expect(verifyMagicLinkToken(db, "not-a-real-token")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects claiming an email already attached to a different user", async () => {
    const first = await createAnonymousUser(db, "First Owner");
    const second = await createAnonymousUser(db, "Second Claimant");
    createdUserIds.push(first.userId, second.userId);

    const email = `taken-${createId()}@example.com`;
    const firstClaim = await createClaimToken(db, first.userId, email);
    await verifyMagicLinkToken(db, firstClaim.rawToken); // first user claims it

    const secondClaim = await createClaimToken(db, second.userId, email);
    await expect(verifyMagicLinkToken(db, secondClaim.rawToken)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("createSessionForUser", () => {
  it("issues a session usable by requireUser", async () => {
    const { userId } = await createAnonymousUser(db, "Second Device");
    createdUserIds.push(userId);

    const session = await createSessionForUser(db, userId);
    const found = await requireUser(db, cookieRequest(session.rawToken));
    expect(found.id).toBe(userId);
  });
});

// Splits a Set-Cookie header string into its attribute map, lowercasing
// keys (cookie attribute names are case-insensitive) — lets a test assert
// on a specific attribute's value rather than doing a brittle substring
// match (`toContain("Path=/")` would also pass for a bug like
// `Path=/api/auth`, since that string also contains "Path=/").
function parseCookieAttributes(header: string): Record<string, string | true> {
  const attrs: Record<string, string | true> = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    attrs[key.toLowerCase()] = rest.length > 0 ? rest.join("=") : true;
  }
  return attrs;
}

describe("cookie builders", () => {
  // Regression test for the production bug (Session 16): the anonymous
  // signup / verify session cookie must carry `Path=/` (so it's sent back
  // on every route, not just the endpoint that set it) and an expiry far
  // in the future (so a closed-then-reopened tab still has a live cookie
  // to send) — the previous version of this test only checked the cookie
  // NAME and HttpOnly were present, which would have passed even with a
  // wrong Path or a missing/near-immediate expiry.
  it("builds a session cookie with Path=/, SameSite=Lax, HttpOnly, and a ~30-day expiry", async () => {
    const { userId } = await createAnonymousUser(db, "Cookie Check");
    createdUserIds.push(userId);
    const session = await createSessionForUser(db, userId);

    const header = buildSessionCookie(session);
    const attrs = parseCookieAttributes(header);

    expect(attrs[SESSION_COOKIE_NAME.toLowerCase()]).toBe(encodeURIComponent(session.rawToken));
    expect(attrs["path"]).toBe("/");
    expect(attrs["httponly"]).toBe(true);
    expect(attrs["samesite"]).toBe("Lax");

    expect(attrs["expires"]).toBeTruthy();
    const expiresAt = new Date(String(attrs["expires"]));
    const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    // Generous window (not exactly 30) so this doesn't flake on slow CI —
    // the point is "weeks away", not "about to expire".
    expect(daysUntilExpiry).toBeGreaterThan(25);
    expect(daysUntilExpiry).toBeLessThan(31);

    // Local/test runs are not NODE_ENV=production, so Secure should be
    // absent here — asserting this (rather than ignoring it) pins down
    // that Secure is conditional on production, not simply missing.
    expect(attrs["secure"]).toBeUndefined();
  });

  // The actual "new tab" scenario, without a browser: read the Set-Cookie
  // header buildSessionCookie() produces exactly as a browser would —
  // split it down to the `name=value` pair, since a real browser strips
  // every other attribute (Path, Expires, etc.) before echoing a cookie
  // back in a later request's `Cookie` header — then feed that back into
  // requireUser() via a brand-new Request. If this round-trip works, a
  // session created by /api/auth/anonymous really is readable by an
  // unrelated later request, which is everything "surviving a new tab"
  // requires.
  it("round-trips: a cookie built by buildSessionCookie is accepted by requireUser", async () => {
    const { userId, session } = await createAnonymousUser(db, "Round Trip");
    createdUserIds.push(userId);

    const setCookieHeader = buildSessionCookie(session);
    const [nameValuePair] = setCookieHeader.split(";");

    // Simulates a genuinely new request (new tab, new connection) that only
    // has whatever the browser persisted from the Set-Cookie header — not
    // anything held in the original response or JS memory.
    const newTabRequest = new Request("http://localhost/api/me", {
      headers: { cookie: nameValuePair },
    });

    const found = await requireUser(db, newTabRequest);
    expect(found.id).toBe(userId);
  });

  it("builds a logout cookie that expires immediately", () => {
    const header = buildLogoutCookie();
    const attrs = parseCookieAttributes(header);
    expect(attrs["path"]).toBe("/");
    expect(attrs["max-age"]).toBe("0");
  });
});
