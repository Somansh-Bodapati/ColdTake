// GET /api/cards/reveal/:seasonId/:timestamp.png — docs/01-PRD.md §6.1's
// "reveal card: everyone's champion pick, at lock." No auth (same
// acquisition-strategy reasoning as the standings card route), but the
// underlying pick-visibility rule (CLAUDE.md rule 6: "picks are invisible
// before lock") is still enforced — src/lib/cards/assemble.ts's
// assembleRevealCard throws 403 via isRevealed(seasonRow.status) before any
// pick is ever read, exactly like api/seasons/[id]/picks/all.ts.

import { db } from "@/lib/db/client";
import { assembleRevealCard } from "@/lib/cards/assemble";
import { buildRevealCardElement } from "@/lib/cards/reveal-card";
import { renderCardToPng } from "@/lib/cards/render";
import { assertCanonicalTimestamp, pngResponse, readTimestampSegment } from "@/lib/cards/http";
import { pathSegment, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const requestedTimestamp = readTimestampSegment(request);

  const { data, timestamp } = await assembleRevealCard(db, seasonId, new Date());
  assertCanonicalTimestamp(requestedTimestamp, timestamp);

  const png = await renderCardToPng(buildRevealCardElement(data));
  return pngResponse(png);
}

export default withErrorHandling(handler);
