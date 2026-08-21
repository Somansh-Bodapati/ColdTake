// GET /api/seasons/:id/picks/all — doc 03 §3.4: "403 before lock, full
// reveal after." This is the route this session's brief calls "the single
// most important security property in the product" (task 1) — see
// ./all.test.ts, written and confirmed red before this file existed.
//
// The gate is exactly two checks, in this order: requireSeasonMember (group
// membership — this session's task 7, same discipline as Sessions 6-7) and
// then isRevealed(seasonRow.status), where seasonRow came from loadSeason's
// lazy lock-state derivation (src/lib/seasons/state.ts's
// effectiveSeasonStatus, CLAUDE.md rule 3) using this handler's own
// `new Date()` — never a client-supplied timestamp, never a cron.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { requireSeasonMember, getAllPicks } from "@/lib/picks/service";
import { isRevealed } from "@/lib/seasons/state";
import { toMemberPicksResponse } from "@/lib/picks/dto";
import type { AllPicksResponse } from "@/lib/schemas/picks";
import { jsonResponse, pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 2);
  const currentUser = await requireUser(db, request);
  const now = new Date();
  const { seasonRow } = await requireSeasonMember(db, seasonId, currentUser.id, now);

  // The security-critical branch: everyone's picks stay 403 until real
  // server time has passed lock_at, regardless of who's asking or what the
  // client claims the time is.
  if (!isRevealed(seasonRow.status)) {
    throw new AppError(403, "Picks are not revealed until the season locks");
  }

  const rows = await getAllPicks(db, seasonId, seasonRow.memberSnapshot ?? []);
  const body: AllPicksResponse = { members: rows.map(toMemberPicksResponse) };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
