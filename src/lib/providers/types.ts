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

// A StandingsProvider implementation's method can permanently, structurally
// not answer a question for a given tier/account (e.g. CricketDataProvider's
// getFinalResult — see cricketdata-provider.ts's doc comment for why champion
// determination isn't attempted). Living here, on the shared contract,
// rather than on any one concrete provider, is what lets a
// provider-agnostic caller like src/lib/seasons/settlement.ts recognize it
// without importing a specific provider class. Deliberately a different
// class from CricketDataProvider's ProviderFetchError: this signals "will
// never succeed," not "failed this time, might succeed on retry" — callers
// should treat it as "no data from this provider for this," never as a
// reason to fall back to stale data or retry.
export class ProviderUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnsupportedError";
  }
}
