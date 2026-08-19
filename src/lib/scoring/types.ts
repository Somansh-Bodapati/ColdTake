// Shared types for the scoring engine. Mirrors docs/03-DATA-MODEL-AND-API.md
// §2.1-2.3. Deliberately structural subsets of the Drizzle row types in
// lib/db/schema.ts (not the rows themselves) so the engine stays decoupled
// from the DB layer per CLAUDE.md rule 1 — callers assemble these from
// query results, the engine never touches drizzle or postgres.

import type { PickAnswer, QuestionConfig, QuestionType } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Result type — typed Result returns per CLAUDE.md's error-handling
// convention (the scoring engine never throws).
// ---------------------------------------------------------------------------

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// ---------------------------------------------------------------------------
// Inputs the engine consumes (doc 03 §2.1)
// ---------------------------------------------------------------------------

/** The engine's view of a `question` row — just what resolvers need. */
export interface Question {
  id: string;
  type: QuestionType;
  config: QuestionConfig;
  points: number;
}

/** The engine's view of a `pick` row. */
export interface Pick {
  questionId: string;
  memberId: string;
  answer: PickAnswer;
}

/** Alias matching the doc's `Answer` naming in the resolver signature. */
export type Answer = PickAnswer;

/**
 * Minimal tournament shape resolvers validate answers against. Assembled by
 * the caller from `tournament`/`team` rows — the engine never looks teams up
 * itself.
 */
export interface Tournament {
  id: string;
  teamIds: string[];
}

export interface FinalResult {
  championTeamId?: string;
  runnerUpTeamId?: string;
}

export interface FinalTableRow {
  teamId: string;
  position: number;
}

export interface StatLeaderEntry {
  playerId: string;
  value: number;
}

/**
 * "final table, stat leaders, final result" (doc 03 §2.1). In projected mode
 * (§2.5) the caller builds this from `live_state` instead of `result` rows —
 * the shape and the engine's logic are identical either way.
 */
export interface ResultSet {
  finalResult?: FinalResult;
  finalTable?: FinalTableRow[];
  statLeaders?: Record<string, StatLeaderEntry[]>;
}

export interface ScoringConfig {
  boldPickEnabled: boolean;
  /** Weight in `multiplier = 1 + (boldness × boldnessWeight)`. Doc default 1.0. */
  boldnessWeight: number;
}

export interface ScoringInput {
  questions: Question[];
  picks: Pick[];
  results: ResultSet;
  config: ScoringConfig;
  /** The frozen snapshot from season.member_snapshot. */
  memberIds: string[];
  isProjected: boolean;
}

// ---------------------------------------------------------------------------
// Outputs (doc 03 §2.1)
// ---------------------------------------------------------------------------

export type PickStatus =
  | "correct"
  | "partial"
  | "incorrect"
  | "pending"
  | "no_pick";

export interface QuestionBreakdown {
  questionId: string;
  awarded: number;
  maxPossible: number;
  status: PickStatus;
  boldnessMultiplier: number;
  explanation: string;
}

export interface MemberStanding {
  memberId: string;
  rank: number;
  points: number;
  breakdown: QuestionBreakdown[];
}

export interface ScoringOutput {
  standings: MemberStanding[];
}

// ---------------------------------------------------------------------------
// Resolvers (doc 03 §2.2)
// ---------------------------------------------------------------------------

export interface ValidationError {
  code: string;
  message: string;
}

export type ValidationResult = Result<true, ValidationError>;

/** The base (pre-boldness) result of scoring one member's answer. */
export interface ResolvedAnswer {
  awarded: number;
  status: PickStatus;
  explanation: string;
}

/**
 * Per-type resolver, per doc 03 §2.2. `validate`/`resolve` are exactly the
 * doc's contract. `boldnessUnits`/`correctUnitSet` are this codebase's
 * extension to satisfy §2.4's per-type boldness rules (e.g. "for top_n_*,
 * compute boldness per team within the answer") without the orchestrator
 * having to switch on question type — a new type still only means adding one
 * resolver file, per the doc's own design goal. Types that opt out of
 * boldness entirely (numeric, per §2.4) simply omit both.
 */
export interface QuestionResolver {
  readonly type: QuestionType;
  validate(
    answer: unknown,
    question: Question,
    tournament: Tournament
  ): ValidationResult;
  resolve(question: Question, answer: Answer, results: ResultSet): ResolvedAnswer;
  /** All "units" (e.g. team IDs) this answer stakes a claim on, for boldness share. */
  boldnessUnits?(answer: Answer): string[];
  /** The set of units that are actually correct for this question, if resolvable yet. */
  correctUnitSet?(question: Question, results: ResultSet): Set<string>;
}
