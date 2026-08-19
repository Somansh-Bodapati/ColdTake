// ManualProvider (this session's brief, task 2) is a thin read layer over
// manual_standings_input, written by saveManualStandings (manual-input.ts).
// Proves it satisfies the StandingsProvider contract against real data, and
// that it degrades gracefully (empty arrays/object, not a throw) when no
// admin has entered anything yet for a tournament.

import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { manualStandingsInput, tournament } from "@/lib/db/schema";
import { createId } from "@/lib/db/id";
import { ManualProvider } from "@/lib/providers/manual-provider";
import { saveManualStandings } from "@/lib/providers/manual-input";
import { insertTestTournament } from "@/lib/seasons/test-support";

const createdTournamentIds: string[] = [];

afterEach(async () => {
  if (createdTournamentIds.length > 0) {
    await db.delete(tournament).where(inArray(tournament.id, createdTournamentIds));
    createdTournamentIds.length = 0;
  }
});

describe("ManualProvider", () => {
  it("reports its source as 'manual'", () => {
    expect(new ManualProvider(db).source).toBe("manual");
  });

  it("returns empty results for a tournament with no manual input saved", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const provider = new ManualProvider(db);

    expect(await provider.getTable(tournamentId)).toEqual([]);
    expect(await provider.getStatLeaders(tournamentId, "runs")).toEqual([]);
    expect(await provider.getFinalResult(tournamentId)).toEqual({});
  });

  it("reads back exactly what was saved via saveManualStandings", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const adminUserId = createId();

    await saveManualStandings(
      db,
      {
        tournamentId,
        tableData: [
          { teamId: "mi", played: 5, won: 4, lost: 1, points: 8, nrr: 0.5, position: 1 },
          { teamId: "csk", played: 5, won: 3, lost: 2, points: 6, nrr: 0.2, position: 2 },
        ],
        statLeaders: { runs: [{ playerId: "player-1", value: 300 }] },
        finalResult: { championTeamId: "mi" },
        updatedBy: adminUserId,
      },
      new Date("2026-04-01T00:00:00.000Z")
    );

    const provider = new ManualProvider(db);
    expect(await provider.getTable(tournamentId)).toEqual([
      { teamId: "mi", played: 5, won: 4, lost: 1, points: 8, nrr: 0.5, position: 1 },
      { teamId: "csk", played: 5, won: 3, lost: 2, points: 6, nrr: 0.2, position: 2 },
    ]);
    expect(await provider.getStatLeaders(tournamentId, "runs")).toEqual([{ playerId: "player-1", value: 300 }]);
    expect(await provider.getStatLeaders(tournamentId, "wickets")).toEqual([]);
    expect(await provider.getFinalResult(tournamentId)).toEqual({ championTeamId: "mi" });
  });

  it("re-saving the same tournament overwrites rather than duplicating the row", async () => {
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const adminUserId = createId();
    const args = {
      tournamentId,
      tableData: [{ teamId: "mi", played: 1, won: 1, lost: 0, points: 2, nrr: 1, position: 1 }],
      statLeaders: {},
      updatedBy: adminUserId,
    };

    await saveManualStandings(db, args, new Date("2026-04-01T00:00:00.000Z"));
    await saveManualStandings(
      db,
      { ...args, tableData: [{ teamId: "mi", played: 2, won: 2, lost: 0, points: 4, nrr: 1, position: 1 }] },
      new Date("2026-04-02T00:00:00.000Z")
    );

    const rows = await db.select().from(manualStandingsInput);
    const forTournament = rows.filter((row) => row.tournamentId === tournamentId);
    expect(forTournament).toHaveLength(1);
    expect(forTournament[0]?.tableData[0]?.played).toBe(2);
  });
});
