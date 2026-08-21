// POST /api/auth/confirm-name — completes the one-time "what's your name"
// prompt shown right after a brand-new Google sign-in (src/lib/auth/google.ts's
// needsNamePrompt). Requires an existing session (the Google callback
// already set one) — this only ever renames the already-authenticated user,
// it never creates one.

import { requireUser } from "../../lib/auth/session.js";
import { confirmDisplayName } from "../../lib/auth/google.js";
import { db } from "../../lib/db/client.js";
import { confirmNameRequestSchema } from "../../lib/schemas/auth.js";
import { jsonResponse, parseJsonBody, withErrorHandling } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const currentUser = await requireUser(db, request);
  const { displayName } = await parseJsonBody(request, confirmNameRequestSchema);

  await confirmDisplayName(db, currentUser.id, displayName);

  return jsonResponse({ ok: true });
}

export default withErrorHandling(handler);
