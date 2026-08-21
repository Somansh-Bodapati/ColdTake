// GET /api/tournaments — doc 03 §3.3: "catalogue, cacheable". Not
// group-scoped (the tournament catalogue is system-owned, doc 03 §1.3), just
// authenticated — this is step 1 of season setup (doc 01 §2.3: "Admin
// selects a tournament from the catalogue").
//
// No Cache-Control here anymore. It originally had `public, max-age=300`
// per CLAUDE.md rule 2 — but "public" is honored by Vercel's edge/CDN cache,
// not just the requesting browser, and a client-side `cache: "no-store"` on
// the fetch call (added earlier tonight to fix "my new tournament doesn't
// show up") only ever bypasses the browser's *local* cache — it can't force
// a shared edge cache to revalidate. Confirmed live: an admin created a
// real tournament (201), immediately reopened season setup, and still saw
// the pre-creation list. This is a tiny full-table read on a table with a
// handful of rows — the Neon-cost case for caching it at all is weak next
// to the correctness cost of an admin not seeing what they just created.

import { db } from "../../lib/db/client.js";
import { requireUser } from "../../lib/auth/session.js";
import { getTournamentCatalogue } from "../../lib/seasons/service.js";
import type { TournamentCatalogueResponse } from "../../lib/schemas/seasons.js";
import { jsonResponse, withErrorHandling } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    throw new AppError(405, "Method not allowed");
  }

  await requireUser(db, request);
  const rows = await getTournamentCatalogue(db);

  const body: TournamentCatalogueResponse = {
    tournaments: rows.map((row) => ({
      id: row.id,
      sport: row.sport,
      name: row.name,
      shortName: row.shortName,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      status: row.status,
      teamCount: row.teamCount,
      config: row.config,
    })),
  };
  return jsonResponse(body);
}

export default withErrorHandling(handler);
