// GET /api/cards/swing/:seasonId/:timestamp.png — docs/01-PRD.md §6.1's
// "swing card: 'Somansh jumped 4 places' after a big result." Compares the
// two most recent standings_snapshot rows (src/lib/cards/assemble.ts) —
// public, same as the other three card routes.

import { db } from "../../../../lib/db/client.js";
import { assembleSwingCard } from "../../../../lib/cards/assemble.js";
import { buildSwingCardElement } from "../../../../lib/cards/swing-card.js";
import { renderCardToPng } from "../../../../lib/cards/render.js";
import { assertCanonicalTimestamp, pngResponse, readTimestampSegment } from "../../../../lib/cards/http.js";
import { pathSegment, withErrorHandling } from "../../../../lib/http.js";
import { AppError } from "../../../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  const seasonId = pathSegment(request, 1);
  const requestedTimestamp = readTimestampSegment(request);

  const { data, timestamp } = await assembleSwingCard(db, seasonId, new Date());
  assertCanonicalTimestamp(requestedTimestamp, timestamp);

  const png = await renderCardToPng(buildSwingCardElement(data));
  return pngResponse(png);
}

export default withErrorHandling(handler);
