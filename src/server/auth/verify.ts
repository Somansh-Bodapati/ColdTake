// POST /api/auth/verify — doc 03 §3.1: { token } -> { userId, sessionToken }
// Consumes a single-use magic-link token (claim, or a future login link),
// attaches the pending email if applicable, and issues a fresh session.

import { db } from "../../lib/db/client.js";
import { verifyRequestSchema } from "../../lib/schemas/auth.js";
import { verifyMagicLinkToken, createSessionForUser, buildSessionCookie } from "../../lib/auth/session.js";
import { jsonResponse, parseJsonBody, withErrorHandling } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const { token } = await parseJsonBody(request, verifyRequestSchema);
  const { userId } = await verifyMagicLinkToken(db, token);
  const session = await createSessionForUser(db, userId);

  return jsonResponse(
    { userId, sessionToken: session.rawToken },
    { status: 200, headers: { "Set-Cookie": buildSessionCookie(session) } }
  );
}

export default withErrorHandling(handler);
