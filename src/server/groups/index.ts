// POST /api/groups — doc 03 §3.2: { name } -> { group, joinCode, inviteUrl }
// Doc 01 §2.1: group creation, authenticated user becomes admin.

import { db } from "../../lib/db/client.js";
import { requireUser } from "../../lib/auth/session.js";
import { createGroup } from "../../lib/groups/service.js";
import { createGroupRequestSchema, type CreateGroupResponse } from "../../lib/schemas/groups.js";
import { appUrl, jsonResponse, parseJsonBody, withErrorHandling } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const currentUser = await requireUser(db, request);
  const { name } = await parseJsonBody(request, createGroupRequestSchema);

  const created = await createGroup(db, { name, creatorUserId: currentUser.id });

  const inviteUrl = `${appUrl()}/join?code=${encodeURIComponent(created.joinCode)}`;

  const body: CreateGroupResponse = { group: created, inviteUrl };
  return jsonResponse(body, { status: 201 });
}

export default withErrorHandling(handler);
