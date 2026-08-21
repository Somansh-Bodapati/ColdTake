// Picks the StandingsProvider implementation configured for a tournament
// (tournament.config.provider, schema.ts's TournamentProviderKey) —
// defaulting to ManualProvider wherever unset, so every tournament created
// before this field existed keeps behaving exactly as it did. Shared by
// every caller that needs a live provider instance rather than reading
// already-ingested `live_state`/`result` rows: api/ingest/[tournamentId].ts
// (originally where this lived, Session 11) and, from Session 12,
// api/seasons/[id]/settle.ts.

import { eq } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import { tournament } from "../db/schema.js";
import { ManualProvider } from "./manual-provider.js";
import { CricketDataProvider } from "./cricketdata-provider.js";
import type { StandingsProvider } from "./types.js";
import { AppError } from "../errors.js";

export async function resolveStandingsProvider(db: Db, tournamentId: string): Promise<StandingsProvider> {
  const [tournamentRow] = await db.select().from(tournament).where(eq(tournament.id, tournamentId)).limit(1);
  if (!tournamentRow) {
    throw new AppError(404, "Tournament not found");
  }

  if (tournamentRow.config.provider === "cricketdata") {
    const apiKey = process.env.CRICKETDATA_API_KEY;
    if (!apiKey) {
      throw new AppError(500, "CRICKETDATA_API_KEY is not configured");
    }
    return new CricketDataProvider(db, { apiKey });
  }

  return new ManualProvider(db);
}
