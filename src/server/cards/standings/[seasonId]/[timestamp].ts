// GET /api/cards/standings/:seasonId/:timestamp.png — docs/01-PRD.md §6.1's
// "standings card: current leaderboard, weekly." No auth: this is meant to
// be pasted into WhatsApp and viewed by people who aren't group members yet
// (this session's brief — "your entire acquisition strategy"), so unlike
// every other seasons/standings route it never calls requireUser. The
// timestamp segment must equal the snapshot's own computed_at
// (src/lib/cards/assemble.ts) or this 404s instead of rendering a
// different snapshot under an already-issued URL.

import { db } from "../../../../lib/db/client";
import { assembleStandingsCard } from "../../../../lib/cards/assemble";
import { buildStandingsCardElement } from "../../../../lib/cards/standings-card";
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

  const { data, timestamp } = await assembleStandingsCard(db, seasonId, new Date());
  assertCanonicalTimestamp(requestedTimestamp, timestamp);

  const png = await renderCardToPng(buildStandingsCardElement(data));
  return pngResponse(png);
}

export default withErrorHandling(handler);
