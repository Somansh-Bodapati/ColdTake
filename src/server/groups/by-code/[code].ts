// GET /api/groups/by-code/:code — public, no auth (this session's brief,
// task 6): the join-by-code landing page (src/routes/join.tsx) needs to
// show "You're invited to join {group.name}" — and set that name into its
// Open Graph tags — before the visitor has signed in or joined anything.
// Mirrors joinGroupByCode's own lookup (src/lib/groups/service.ts) but
// read-only and without requiring a session.

import { db } from "../../../lib/db/client";
import { getGroupByJoinCode } from "../../../lib/groups/service";
import { joinCodeSchema, type GroupPreviewResponse } from "../../../lib/schemas/groups";
import { jsonResponse, pathSegment, withErrorHandling } from "../../../lib/http";
import { AppError } from "../../../lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const rawCode = pathSegment(request, 0);
  const parsed = joinCodeSchema.safeParse(rawCode);
  if (!parsed.success) {
    throw new AppError(404, "Invalid join code");
  }

  const group = await getGroupByJoinCode(db, parsed.data);

  const body: GroupPreviewResponse = { id: group.id, name: group.name };
  // Short client-side cache is fine (doc 02 §3.4-style discipline extends
  // to every public GET, not just standings) — a group's name changes
  // rarely and this is never the security boundary (joining still requires
  // a session + the code itself).
  return jsonResponse(body, { headers: { "cache-control": "public, max-age=300" } });
}

export default withErrorHandling(handler);
