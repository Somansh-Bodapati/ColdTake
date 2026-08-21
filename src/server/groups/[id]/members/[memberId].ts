// DELETE /api/groups/:id/members/:mid — doc 03 §3.2 [admin]. Admin-scoped:
// verifies the caller is the admin of this specific group (this session's
// brief, task 6) before removing anyone.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireAdmin, removeMember } from "@/lib/groups/service";
import type { OkResponse } from "@/lib/schemas/groups";
import { jsonResponse, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "DELETE") {
    throw new AppError(405, "Method not allowed");
  }

  const memberId = pathSegment(request, 0);
  const groupId = pathSegment(request, 2);
  const currentUser = await requireUser(db, request);
  await requireAdmin(db, groupId, currentUser.id);

  await removeMember(db, groupId, memberId);

  const body: OkResponse = { ok: true };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
