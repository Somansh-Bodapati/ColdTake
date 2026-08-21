// Google Sign-In (docs/DECISIONS.md: the anonymous-first flow stays exactly
// as-is; this is an additional identity path, not a replacement). No OAuth
// library — Google's endpoints are plain REST/JSON, and CLAUDE.md's "no new
// dependency without asking" default applies. Only plain `fetch` (injectable
// for tests, same `FetchLike` pattern as cricketdata-provider.ts) plus the
// existing token-hashing helpers from tokens.ts.
//
// Two legs:
//   1. GET /api/auth/google builds the authorize URL and stashes a `state`
//      value for CSRF protection.
//   2. GET /api/auth/google/callback verifies `state`, exchanges `code` for
//      tokens, fetches the profile, and finds/links/creates the `user` row.

import { eq } from "drizzle-orm";
import type { db as dbClient } from "../db/client.js";
import { user } from "../db/schema.js";
import { createId } from "../db/id.js";
import { generateRawToken, hashToken, hashesEqual } from "./tokens.js";
import { createSessionForUser, type IssuedToken } from "./session.js";
import { AppError } from "../errors.js";

export type Db = typeof dbClient;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const GOOGLE_STATE_COOKIE_NAME = "ct_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — just long enough for the consent screen

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:5173";
}

// Must exactly match one of the URIs registered on the Google Cloud OAuth
// app (authorize step and token-exchange step both send this, and Google
// rejects a mismatch) — APP_URL is already set per-environment for exactly
// this purpose (see claim.ts's identical use for the magic-link URL).
export function googleRedirectUri(): string {
  return `${appUrl()}/api/auth/google/callback`;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// Only the hash of `state` is ever stored (mirrors tokens.ts: "never keep
// the bearer value itself readable") — the cookie holds hashToken(rawState),
// and the callback re-hashes the state query param and compares with
// hashesEqual, exactly like a session/claim token lookup.
export function buildStateCookie(rawState: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const expires = new Date(Date.now() + STATE_TTL_MS).toUTCString();
  return (
    `${GOOGLE_STATE_COOKIE_NAME}=${encodeURIComponent(hashToken(rawState))}; Path=/; HttpOnly; ` +
    `SameSite=Lax; Expires=${expires}${secure}`
  );
}

export function buildClearStateCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${GOOGLE_STATE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function readStateCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === GOOGLE_STATE_COOKIE_NAME) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

// Verifies the callback's `state` query param against the cookie set by the
// authorize step. This is the CSRF protection: without it, an attacker could
// start their own Google OAuth flow, capture the resulting `code`, and trick
// a victim's browser into completing the callback (logging the victim into
// the attacker's Google-linked account). Rejects with no further detail on
// any mismatch — same "don't leak which part was wrong" posture as
// verifyMagicLinkToken.
export function verifyState(request: Request, stateParam: string | null): void {
  const cookieHash = readStateCookie(request);
  if (!cookieHash || !stateParam) {
    throw new AppError(400, "This sign-in attempt has expired. Please try again.");
  }
  if (!hashesEqual(hashToken(stateParam), cookieHash)) {
    throw new AppError(400, "This sign-in attempt could not be verified. Please try again.");
  }
}

export function googleAuthorizationUrl(rawState: string): string {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", rawState);
  return url.toString();
}

export function generateState(): string {
  return generateRawToken();
}

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// POST https://oauth2.googleapis.com/token — exchanges the authorization
// `code` for an access token. `redirect_uri` here must be byte-identical to
// what the authorize step sent (Google's own requirement).
export async function exchangeCodeForToken(fetchImpl: FetchLike, code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    code,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
  });

  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new AppError(502, "Could not complete Google sign-in");
  }

  const data = (await response.json()) as GoogleTokenResponse;
  if (!data.access_token) {
    throw new AppError(502, "Could not complete Google sign-in");
  }
  return data.access_token;
}

export interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
}

// GET https://www.googleapis.com/oauth2/v3/userinfo — the profile behind the
// access token just minted.
export async function fetchGoogleProfile(
  fetchImpl: FetchLike,
  accessToken: string
): Promise<GoogleProfile> {
  const response = await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new AppError(502, "Could not fetch your Google profile");
  }

  const data = (await response.json()) as GoogleProfile;
  if (!data.sub) {
    throw new AppError(502, "Google did not return a profile");
  }
  return data;
}

export interface GoogleSignInResult {
  userId: string;
  isNewUser: boolean;
  session: IssuedToken;
  displayNameConfirmedAt: Date | null;
}

// A brand-new Google user without a confirmed name still needs the one-time
// "what's your name" prompt; every other path (returning Google user, or an
// existing anonymous/claimed account just linked by email) already has a
// name it chose itself.
export function needsNamePrompt(displayNameConfirmedAt: Date | null): boolean {
  return displayNameConfirmedAt === null;
}

// Find-or-create, in priority order:
//   1. A user already linked to this googleId -> log them in as-is.
//   2. No googleId match, but a verified email matches an existing user
//      (e.g. one created via the anonymous+magic-link claim flow) -> link
//      googleId onto that row rather than creating a duplicate account. That
//      account already has a real display name it chose, so mark the name
//      prompt as satisfied if it wasn't already.
//   3. Otherwise, create a brand-new user, seeded with a placeholder name
//      derived from the Google profile (schema decision: displayName stays
//      NOT NULL; displayNameConfirmedAt gates the one-time prompt instead of
//      making callers everywhere handle a null name).
export async function findOrCreateGoogleUser(db: Db, profile: GoogleProfile): Promise<GoogleSignInResult> {
  const [byGoogleId] = await db.select().from(user).where(eq(user.googleId, profile.sub)).limit(1);
  if (byGoogleId) {
    const session = await createSessionForUser(db, byGoogleId.id);
    return {
      userId: byGoogleId.id,
      isNewUser: false,
      session,
      displayNameConfirmedAt: byGoogleId.displayNameConfirmedAt,
    };
  }

  if (profile.email && profile.email_verified) {
    const [byEmail] = await db.select().from(user).where(eq(user.email, profile.email)).limit(1);
    if (byEmail) {
      const displayNameConfirmedAt = byEmail.displayNameConfirmedAt ?? new Date();
      await db
        .update(user)
        .set({ googleId: profile.sub, displayNameConfirmedAt })
        .where(eq(user.id, byEmail.id));
      const session = await createSessionForUser(db, byEmail.id);
      return { userId: byEmail.id, isNewUser: false, session, displayNameConfirmedAt };
    }
  }

  const userId = createId();
  const placeholderName = profile.given_name?.trim() || profile.name?.trim() || "Player";
  const verifiedEmail = profile.email && profile.email_verified ? profile.email : null;
  await db.insert(user).values({
    id: userId,
    displayName: placeholderName,
    email: verifiedEmail,
    avatarSeed: userId,
    googleId: profile.sub,
    claimedAt: verifiedEmail ? new Date() : null,
    displayNameConfirmedAt: null,
  });
  const session = await createSessionForUser(db, userId);
  return { userId, isNewUser: true, session, displayNameConfirmedAt: null };
}

// POST /api/auth/confirm-name — sets the real display name after the
// one-time prompt and marks it confirmed so the prompt never shows again.
export async function confirmDisplayName(db: Db, userId: string, displayName: string): Promise<void> {
  await db
    .update(user)
    .set({ displayName, displayNameConfirmedAt: new Date() })
    .where(eq(user.id, userId));
}
