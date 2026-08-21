// POST /api/auth/logout — doc 03 §3.1. Revokes the current session token
// and clears the cookie. No-op (still 200) if there was no valid session.

import { db } from "../../lib/db/client.js";
import { revokeSession, buildLogoutCookie } from "../../lib/auth/session.js";
import { jsonResponse, withErrorHandling } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  await revokeSession(db, request);

  return jsonResponse({ ok: true }, { headers: { "Set-Cookie": buildLogoutCookie() } });
}

export default withErrorHandling(handler);
