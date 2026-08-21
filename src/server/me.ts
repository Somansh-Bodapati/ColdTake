// GET /api/me — doc 03 §3.1: -> { user, groups[] }
// The one endpoint client session state (src/lib/session/context.tsx) polls
// on load to find out who's signed in and which groups they belong to.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, member } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import type { MeResponse } from "@/lib/schemas/auth";
import { jsonResponse, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const currentUser = await requireUser(db, request);

  const rows = await db
    .select({
      id: group.id,
      name: group.name,
      slug: group.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(group, eq(member.groupId, group.id))
    .where(and(eq(member.userId, currentUser.id), isNull(member.removedAt)));

  const body: MeResponse = {
    user: {
      id: currentUser.id,
      displayName: currentUser.displayName,
      email: currentUser.email,
      avatarSeed: currentUser.avatarSeed,
      claimedAt: currentUser.claimedAt ? currentUser.claimedAt.toISOString() : null,
    },
    groups: rows,
  };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
