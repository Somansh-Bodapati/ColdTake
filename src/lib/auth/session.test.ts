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

describe("cookie builders", () => {
  it("builds an HttpOnly, SameSite=Lax Set-Cookie for a session", async () => {
    const { userId } = await createAnonymousUser(db, "Cookie Check");
    createdUserIds.push(userId);
    const session = await createSessionForUser(db, userId);

    const header = buildSessionCookie(session);
    expect(header).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("builds a logout cookie that expires immediately", () => {
    const header = buildLogoutCookie();
    expect(header).toContain("Max-Age=0");
  });
});
