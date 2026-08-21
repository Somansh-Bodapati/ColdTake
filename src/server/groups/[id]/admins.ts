// POST /api/groups/:id/admins — doc 03 §3.2, revised for multi-admin support:
// { memberId } -> promotes the target to admin without touching anyone
// else's role. Admin-scoped (this session's brief, task 6): verifies the
// caller is CURRENTLY an admin of this specific group — ANY admin can
// promote another member, not a single "the" admin, per the product owner's
// explicit request for equal-power multiple admins. Replaces the old
// destructive POST /api/groups/:id/transfer, which demoted the caller in the
// same statement it promoted someone else.

import { db } from "../../../lib/db/client.js";
import { requireUser } from "../../../lib/auth/session.js";
import { requireAdmin, promoteToAdmin } from "../../../lib/groups/service.js";
import { promoteAdminRequestSchema, type OkResponse } from "../../../lib/schemas/groups.js";
import { jsonResponse, parseJsonBody, pathSegment, withErrorHandling } from "../../../lib/http.js";
import { AppError } from "../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const groupId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  await requireAdmin(db, groupId, currentUser.id);
  const { memberId } = await parseJsonBody(request, promoteAdminRequestSchema);

  await promoteToAdmin(db, groupId, memberId);

  const body: OkResponse = { ok: true };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
