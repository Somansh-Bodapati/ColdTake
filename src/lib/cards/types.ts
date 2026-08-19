// Data contracts for the four share-card types (docs/01-PRD.md §6.1). Each
// is a plain, already-resolved object — no DB row shapes, no ids that need
// a further join to become human-readable — so the element builders in this
// folder (reveal-card.ts etc.) stay pure functions of data, testable without
// touching Postgres. src/lib/cards/assemble.ts is the only place that reads
// the DB and turns rows into these shapes.

// Carried on every card (this session's brief, task 5): "Every card must
// include the group name and a join link" (doc 01 §6.1).
export interface CardBranding {
  groupName: string;
  joinUrl: string;
}

export interface RevealCardPick {
  displayName: string;
  answerLabel: string;
}

export interface RevealCardData extends CardBranding {
  seasonName: string;
  // The question this reveal highlights — PRD §6.1's "everyone's champion
  // pick, at lock." Not hardcoded to a literal "champion" question type in
  // the type itself, since a season is free to have none (assemble.ts picks
  // the best available one and falls back sensibly).
  highlightPrompt: string;
  picks: RevealCardPick[];
}

export interface StandingsCardRow {
  rank: number;
  displayName: string;
  points: number;
  delta: number;
}

export interface StandingsCardData extends CardBranding {
  seasonName: string;
  isProjected: boolean;
  computedAt: string; // ISO
  standings: StandingsCardRow[]; // already truncated to the card's row limit
}

export interface SwingCardData extends CardBranding {
  seasonName: string;
  displayName: string;
  fromRank: number;
  toRank: number;
  fromPoints: number;
  toPoints: number;
  asOf: string; // ISO — the later snapshot's computedAt
}

export interface RecapCardStanding {
  rank: number;
  displayName: string;
  points: number;
}

export interface RecapCardCall {
  displayName: string;
  questionPrompt: string;
  points: number;
  maxPossible: number;
}

export interface RecapCardData extends CardBranding {
  seasonName: string;
  finalStandings: RecapCardStanding[]; // already truncated to the card's row limit
  bestCall?: RecapCardCall;
  worstCall?: RecapCardCall;
}
