// GET /api/auth/google/callback — Google redirects here with `code`+`state`
// (consent granted) or an `error` (declined/failed). Verifies `state`
// against the cookie set by GET /api/auth/google, exchanges `code` for an
// access token, fetches the Google profile, finds-or-creates the `user` row,
// issues a session (same hashed-token/cookie mechanism as
// src/server/auth/anonymous.ts), and redirects back into the app.

import {
  verifyState,
  exchangeCodeForToken,
  fetchGoogleProfile,
  findOrCreateGoogleUser,
  needsNamePrompt,
  buildClearStateCookie,
} from "../../../lib/auth/google.js";
import { buildSessionCookie } from "../../../lib/auth/session.js";
import { db } from "../../../lib/db/client.js";
import { googleCallbackQuerySchema } from "../../../lib/schemas/auth.js";
import { appUrl, requestUrl, redirectResponse, withErrorHandling } from "../../../lib/http.js";
import { AppError } from "../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const url = requestUrl(request);
  const query = googleCallbackQuerySchema.parse({
    code: url.searchParams.get("code") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    error: url.searchParams.get("error") ?? undefined,
  });

  // The user declined consent (or Google reported some other error) — clear
  // the state cookie and send them back to the entry screen rather than
  // surfacing a raw error page.
  if (query.error || !query.code) {
    return redirectResponse(`${appUrl()}/?google_error=1`, {
      headers: { "Set-Cookie": buildClearStateCookie() },
    });
  }

  verifyState(request, query.state ?? null);

  const accessToken = await exchangeCodeForToken(fetch, query.code);
  const profile = await fetchGoogleProfile(fetch, accessToken);
  const { session, displayNameConfirmedAt } = await findOrCreateGoogleUser(db, profile);

  const destination = needsNamePrompt(displayNameConfirmedAt) ? `${appUrl()}/?welcome=1` : `${appUrl()}/`;

  const headers = new Headers();
  headers.append("Set-Cookie", buildSessionCookie(session));
  headers.append("Set-Cookie", buildClearStateCookie());
  return redirectResponse(destination, { headers });
}

export default withErrorHandling(handler);
