// GET /api/tournaments — doc 03 §3.3: "catalogue, cacheable". Not
// group-scoped (the tournament catalogue is system-owned, doc 03 §1.3), just
// authenticated — this is step 1 of season setup (doc 01 §2.3: "Admin
// selects a tournament from the catalogue"). Cache-Control per CLAUDE.md
// rule 2 ("Add Cache-Control to public GET endpoints") — a plain full-table
// read with no per-user data, safe to cache briefly.

import { db } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { getTournamentCatalogue } from "@/lib/seasons/service";
import type { TournamentCatalogueResponse } from "@/lib/schemas/seasons";
import { jsonResponse, withErrorHandling } from "@/lib/http";
import { AppError } from "@/lib/errors";

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
  return jsonResponse(body, { headers: { "Cache-Control": "public, max-age=300" } });
}

export default withErrorHandling(handler);
