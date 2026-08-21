// DELETE /api/groups/:id/admins/:memberId — demotes an admin back to a plain
// member. Admin-scoped, same as POST /api/groups/:id/admins: ANY current
// admin can demote another admin. demoteFromAdmin itself refuses (400) when
// the target is the group's only remaining admin — a group must always have
// at least one. Mirrors DELETE /api/groups/:id/members/:memberId's shape
// (memberId from the path, no body) rather than reusing that route, since
// removing a member and revoking admin-without-removing-them are distinct
// actions with distinct guards.

import { db } from "../../../../lib/db/client.js";
import { requireUser } from "../../../../lib/auth/session.js";
import { requireAdmin, demoteFromAdmin } from "../../../../lib/groups/service.js";
import type { OkResponse } from "../../../../lib/schemas/groups.js";
import { jsonResponse, pathSegment, withErrorHandling } from "../../../../lib/http.js";
import { AppError } from "../../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "DELETE") {
    throw new AppError(405, "Method not allowed");
  }

  const memberId = pathSegment(request, 0);
  const groupId = pathSegment(request, 2);
  const currentUser = await requireUser(db, request);
  await requireAdmin(db, groupId, currentUser.id);

  await demoteFromAdmin(db, groupId, memberId);

  const body: OkResponse = { ok: true };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
