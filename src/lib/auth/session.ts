// Anonymous-first auth (docs/DECISIONS.md, doc 01 §7.1): a display name
// creates a user + session with no email required; a magic link later lets
// that user attach an email and "claim" the account. No dedicated session
// table exists in the schema (Session 1), so sessions reuse `auth_token`
// with purpose='session', per this session's brief.
//
// Only ever store a hash of a bearer token (src/lib/auth/tokens.ts) — the
// raw value lives only in the Set-Cookie header / the claim response body,
// never in the DB.

import { and, eq, gt, isNull } from "drizzle-orm";
import type { db as dbClient } from "@/lib/db/client";
import { authToken, user, type AuthTokenPurpose } from "@/lib/db/schema";
import { createId } from "@/lib/db/id";
import { generateRawToken, hashToken } from "@/lib/auth/tokens";
import { AppError } from "@/lib/errors";

export type Db = typeof dbClient;

export const SESSION_COOKIE_NAME = "ct_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CLAIM_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes, per doc 03 §5

export interface IssuedToken {
  rawToken: string;
  expiresAt: Date;
}

async function insertAuthToken(
  db: Db,
  args: {
    userId: string;
    purpose: AuthTokenPurpose;
    ttlMs: number;
    email?: string;
  }
): Promise<IssuedToken> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + args.ttlMs);
  await db.insert(authToken).values({
    id: createId(),
    userId: args.userId,
    tokenHash: hashToken(rawToken),
    purpose: args.purpose,
    email: args.email ?? null,
    expiresAt,
  });
  return { rawToken, expiresAt };
}

// Creates a brand-new anonymous user (display name only) plus their first
// session. Used by POST /api/auth/anonymous.
export async function createAnonymousUser(
  db: Db,
  displayName: string
): Promise<{ userId: string; session: IssuedToken }> {
  const userId = createId();
  await db.insert(user).values({
    id: userId,
    displayName,
    avatarSeed: userId, // deterministic: derived from the id itself
  });
  const session = await insertAuthToken(db, {
    userId,
    purpose: "session",
    ttlMs: SESSION_TTL_MS,
  });
  return { userId, session };
}

export async function createSessionForUser(db: Db, userId: string): Promise<IssuedToken> {
  return insertAuthToken(db, { userId, purpose: "session", ttlMs: SESSION_TTL_MS });
}

// Issues a single-use, short-expiry magic-link token for attaching `email`
// to `userId`. No email provider is wired up yet (docs/DECISIONS.md), so
// the caller (api/auth/claim.ts) logs/returns the raw token instead of
// emailing it.
export async function createClaimToken(
  db: Db,
  userId: string,
  email: string
): Promise<IssuedToken> {
  return insertAuthToken(db, { userId, purpose: "claim", ttlMs: CLAIM_TOKEN_TTL_MS, email });
}

interface VerifiedClaim {
  userId: string;
  purpose: AuthTokenPurpose;
  email: string | null;
}

// Looks up a magic-link token by its hash, checks it's unused and unexpired,
// marks it used (single-use), and — for 'claim' tokens — attaches the
// pending email to the user. Returns the affected userId so the caller can
// mint a fresh session. Throws AppError(400) for any invalid/expired/
// already-used token, deliberately without distinguishing which (doc 03 §5
// treats these the same to avoid leaking token state to an attacker).
export async function verifyMagicLinkToken(db: Db, rawToken: string): Promise<VerifiedClaim> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select()
    .from(authToken)
    .where(
      and(
        eq(authToken.tokenHash, tokenHash),
        isNull(authToken.usedAt),
        gt(authToken.expiresAt, now)
      )
    )
    .limit(1);

  if (!row || (row.purpose !== "claim" && row.purpose !== "login")) {
    throw new AppError(400, "This link is invalid or has expired");
  }

  if (row.purpose === "claim" && row.email) {
    const [emailOwner] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, row.email))
      .limit(1);
    if (emailOwner && emailOwner.id !== row.userId) {
      throw new AppError(409, "That email is already claimed by another account");
    }
    await db
      .update(user)
      .set({ email: row.email, claimedAt: now })
      .where(eq(user.id, row.userId));
  }

  await db.update(authToken).set({ usedAt: now }).where(eq(authToken.id, row.id));

  return { userId: row.userId, purpose: row.purpose, email: row.email };
}

export interface SessionUser {
  id: string;
  displayName: string;
  email: string | null;
  avatarSeed: string;
  claimedAt: Date | null;
}

// Reads the session cookie off `request`, validates it against `auth_token`,
// and returns the current user. Throws AppError(401) for a missing,
// unknown, expired, or revoked session — the one helper every other
// protected route imports (this session's brief, task 3).
export async function requireUser(db: Db, request: Request): Promise<SessionUser> {
  const rawToken = readSessionCookie(request);
  if (!rawToken) {
    throw new AppError(401, "Not signed in");
  }

  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarSeed: user.avatarSeed,
      claimedAt: user.claimedAt,
    })
    .from(authToken)
    .innerJoin(user, eq(authToken.userId, user.id))
    .where(
      and(
        eq(authToken.tokenHash, tokenHash),
        eq(authToken.purpose, "session"),
        isNull(authToken.usedAt),
        gt(authToken.expiresAt, now)
      )
    )
    .limit(1);

  if (!row) {
    throw new AppError(401, "Session expired or invalid");
  }

  return row;
}

// Revokes the caller's current session (logout). Reuses `usedAt` as a
// revocation marker — requireUser already excludes used tokens.
export async function revokeSession(db: Db, request: Request): Promise<void> {
  const rawToken = readSessionCookie(request);
  if (!rawToken) {
    return;
  }
  await db
    .update(authToken)
    .set({ usedAt: new Date() })
    .where(and(eq(authToken.tokenHash, hashToken(rawToken)), eq(authToken.purpose, "session")));
}

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === SESSION_COOKIE_NAME) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

export function buildSessionCookie(token: IssuedToken): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return (
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token.rawToken)}; Path=/; HttpOnly; ` +
    `SameSite=Lax; Expires=${token.expiresAt.toUTCString()}${secure}`
  );
}

export function buildLogoutCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
