// POST /api/groups/:id/transfer — doc 03 §3.2: { memberId } -> [admin].
// Admin-scoped (this session's brief, task 6): verifies the caller is the
// admin of this specific group before handing the role to someone else.

import { db } from "../../../lib/db/client.js";
import { requireUser } from "../../../lib/auth/session.js";
import { requireAdmin, transferAdmin } from "../../../lib/groups/service.js";
import { transferAdminRequestSchema, type OkResponse } from "../../../lib/schemas/groups.js";
import { jsonResponse, parseJsonBody, pathSegment, withErrorHandling } from "../../../lib/http.js";
import { AppError } from "../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const groupId = pathSegment(request, 1);
  const currentUser = await requireUser(db, request);
  const admin = await requireAdmin(db, groupId, currentUser.id);
  const { memberId } = await parseJsonBody(request, transferAdminRequestSchema);

  await transferAdmin(db, groupId, { currentAdminMemberId: admin.memberId, targetMemberId: memberId });

  const body: OkResponse = { ok: true };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
