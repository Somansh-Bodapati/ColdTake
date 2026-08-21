// POST /api/groups/join — doc 03 §3.2: { joinCode } -> { group }
// Doc 01 §2.2: joining a group via join code creates a member row for the
// authenticated user. Rate-limited (this session's brief, task 7) — see
// src/lib/groups/rate-limit.ts for the exact mechanism and its known
// limitation under serverless.

import { db } from "../../lib/db/client";
import { requireUser } from "../../lib/auth/session";
import { joinGroupByCode } from "../../lib/groups/service";
import { hitRateLimit } from "../../lib/groups/rate-limit";
import { joinGroupRequestSchema, type JoinGroupResponse } from "../../lib/schemas/groups";
import { jsonResponse, parseJsonBody, withErrorHandling } from "../../lib/http";
import { AppError } from "../../lib/errors";

// Generous enough that a real user re-entering a mistyped code a few times
// never hits it, tight enough to blunt a script trying to brute-force
// someone else's 6-character code (32^6 ≈ 1.07 billion possibilities, so
// the real defense is the keyspace — this just stops a single warm instance
// from being hammered at high speed).
const JOIN_RATE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // Safe: String.split always returns a non-empty array (at least one
    // element), even for a string with no commas.
    return forwardedFor.split(",")[0]!.trim();
  }
  return "unknown";
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new AppError(405, "Method not allowed");
  }

  const rateLimitKey = clientIp(request);
  const rateLimit = hitRateLimit(rateLimitKey, JOIN_RATE_LIMIT);
  if (!rateLimit.allowed) {
    throw new AppError(429, "Too many join attempts — try again later");
  }

  const currentUser = await requireUser(db, request);
  const { joinCode } = await parseJsonBody(request, joinGroupRequestSchema);

  const joined = await joinGroupByCode(db, { joinCode, userId: currentUser.id });

  const body: JoinGroupResponse = { group: joined };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
