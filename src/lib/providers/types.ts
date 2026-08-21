// The StandingsProvider interface — doc 02 §4.3: "the single highest-
// leverage design decision in the project." Every path from sports data
// into ColdTake goes through an implementation of this interface
// (CLAUDE.md rule 4: "StandingsProvider is the only path to sports data. No
// scoring or UI code calls an external API directly"). This session ships
// exactly one implementation, ManualProvider (manual-provider.ts); a later
// session adds CricketDataProvider (docs/DECISIONS.md) behind the same
// three methods, so nothing above this layer has to change.
//
// Return types are structural subsets reused directly from
// src/lib/db/schema.ts (LiveStateTableRow/LiveStateStatLeaderEntry) and
// src/lib/scoring/types.ts (FinalResult) rather than re-declared here — the
// doc's own sketch names them TeamStanding/PlayerStat/TournamentResult, kept
// below as aliases so call sites can use the doc's vocabulary without a
// second, divergent type definition.

import type { LiveStateStatLeaderEntry, LiveStateTableRow } from "../db/schema.js";
import type { FinalResult } from "../scoring/types.js";

export type TeamStanding = LiveStateTableRow;
export type PlayerStat = LiveStateStatLeaderEntry;
export type TournamentResult = FinalResult;

export interface StandingsProvider {
  // Written to live_state.source / result.source (schema.ts's ResultSource
  // union) so ingestion output is always traceable to the provider that
  // produced it.
  readonly source: string;
  getTable(tournamentId: string): Promise<TeamStanding[]>;
  getStatLeaders(tournamentId: string, category: string): Promise<PlayerStat[]>;
  getFinalResult(tournamentId: string): Promise<TournamentResult>;
}
