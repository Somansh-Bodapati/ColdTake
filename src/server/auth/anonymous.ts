// POST /api/auth/anonymous — doc 03 §3.1: { displayName } -> { userId, sessionToken }
// Anonymous-first auth (doc 01 §7.1): this is the entire signup flow. No
// email, no password — a display name creates a user + session cookie.

import { db } from "../../lib/db/client.js";
import { anonymousSignupRequestSchema } from "../../lib/schemas/auth.js";
import { createAnonymousUser, buildSessionCookie } from "../../lib/auth/session.js";
import { jsonResponse, parseJsonBody, withErrorHandling } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const { displayName } = await parseJsonBody(request, anonymousSignupRequestSchema);
  const { userId, session } = await createAnonymousUser(db, displayName);

  return jsonResponse(
    { userId, sessionToken: session.rawToken },
    { status: 201, headers: { "Set-Cookie": buildSessionCookie(session) } }
  );
}

export default withErrorHandling(handler);
