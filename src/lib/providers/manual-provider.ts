// The provider Session 10 ships first (doc 02 §4.3: "Ship ManualProvider
// first ... Week 1 has zero external dependency"). Reads whatever an admin
// most recently saved via POST /api/admin/manual-standings/:tournamentId
// (src/lib/providers/manual-input.ts's saveManualStandings) out of the
// manual_standings_input table, rather than calling any external API — the
// entire point of the interface (CLAUDE.md rule 4).

import { eq } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import { manualStandingsInput } from "../db/schema.js";
import type { PlayerStat, StandingsProvider, TeamStanding, TournamentResult } from "./types.js";

export class ManualProvider implements StandingsProvider {
  readonly source = "manual";

  constructor(private readonly db: Db) {}

  async getTable(tournamentId: string): Promise<TeamStanding[]> {
    const row = await this.loadRow(tournamentId);
    return row?.tableData ?? [];
  }

  async getStatLeaders(tournamentId: string, category: string): Promise<PlayerStat[]> {
    const row = await this.loadRow(tournamentId);
    return row?.statLeaders[category] ?? [];
  }

  async getFinalResult(tournamentId: string): Promise<TournamentResult> {
    const row = await this.loadRow(tournamentId);
    return row?.finalResult ?? {};
  }

  private async loadRow(tournamentId: string) {
    const [row] = await this.db
      .select()
      .from(manualStandingsInput)
      .where(eq(manualStandingsInput.tournamentId, tournamentId))
      .limit(1);
    return row;
  }
}
