// GET /api/cards/recap/:seasonId/:timestamp.png — docs/01-PRD.md §6.1's
// "recap card: final standings and the season's best and worst calls."
// Only renders once the season is settled (src/lib/cards/assemble.ts throws
// 409 otherwise) — public, same as the other three card routes.

import { db } from "../../../../lib/db/client";
import { assembleRecapCard } from "../../../../lib/cards/assemble";
import { buildRecapCardElement } from "../../../../lib/cards/recap-card";
import { renderCardToPng } from "../../../../lib/cards/render";
import { assertCanonicalTimestamp, pngResponse, readTimestampSegment } from "../../../../lib/cards/http";
import { pathSegment, withErrorHandling } from "../../../../lib/http";
import { AppError } from "../../../../lib/errors";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const requestedTimestamp = readTimestampSegment(request);

  const { data, timestamp } = await assembleRecapCard(db, seasonId, new Date());
  assertCanonicalTimestamp(requestedTimestamp, timestamp);

  const png = await renderCardToPng(buildRecapCardElement(data));
  return pngResponse(png);
}

export default withErrorHandling(handler);
