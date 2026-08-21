// GET /api/groups/:id — doc 03 §3.2: -> group + members (+ seasons, once
// seasons exist — Milestone 3+). Group-scoped: verifies the caller is a
// member of this specific group (this session's brief, task 6) before
// returning anything.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireMembership, getGroupDetail } from "@/lib/groups/service";
import { listSeasonsByGroup } from "@/lib/seasons/service";
import type { GroupDetailResponse } from "@/lib/schemas/groups";
import { jsonResponse, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const groupId = pathSegment(request, 0);
  const currentUser = await requireUser(db, request);
  await requireMembership(db, groupId, currentUser.id);

  const now = new Date();
  const [detail, seasonRows] = await Promise.all([
    getGroupDetail(db, groupId),
    listSeasonsByGroup(db, groupId, now),
  ]);

  const body: GroupDetailResponse = {
    ...detail,
    seasons: seasonRows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      lockAt: row.lockAt.toISOString(),
    })),
  };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
