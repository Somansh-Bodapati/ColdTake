// GET /api/auth/google — starts the Google Sign-In flow. Builds Google's
// OAuth 2.0 authorization URL and redirects the browser there (a real 302,
// not JSON — Google's own consent screen has to load), stashing a `state`
// value in a short-lived cookie so the callback can verify it came back from
// a flow we actually started (CSRF protection, src/lib/auth/google.ts's
// verifyState).

import { googleAuthorizationUrl, generateState, buildStateCookie } from "../../lib/auth/google.js";
import { redirectResponse, withErrorHandling } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const state = generateState();
  const authorizationUrl = googleAuthorizationUrl(state);

  return redirectResponse(authorizationUrl, {
    headers: { "Set-Cookie": buildStateCookie(state) },
  });
}

export default withErrorHandling(handler);
