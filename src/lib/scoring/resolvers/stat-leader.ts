// stat_leader resolver — doc 03 §2.3: "Exact match on the leader in
// config.statCategory. On a tie in the underlying stat, all tied players
// count as correct." Doc 01 §4.3's injured/didn't-play edge case needs no
// special handling: a player absent from the leaderboard is simply not the
// leader, so it falls out of the exact-match rule for free.
// Pure: no I/O, no Date.now(), no DB access (CLAUDE.md rule 1).

import type {
  Answer,
  Question,
  QuestionResolver,
  ResolvedAnswer,
  ResultSet,
  Tournament,
  ValidationResult,
} from "@/lib/scoring/types";

function configStatCategory(question: Question): string | undefined {
  const statCategory = question.config.statCategory;
  return typeof statCategory === "string" && statCategory.length > 0 ? statCategory : undefined;
}

function validate(
  answer: unknown,
  question: Question,
  _tournament: Tournament
): ValidationResult {
  if (configStatCategory(question) === undefined) {
    return {
      ok: false,
      error: {
        code: "invalid_config",
        message: "Question config.statCategory must be a non-empty string.",
      },
    };
  }
  if (typeof answer !== "object" || answer === null) {
    return {
      ok: false,
      error: { code: "invalid_shape", message: "Answer must be an object." },
    };
  }
  const playerId = (answer as Answer).playerId;
  if (typeof playerId !== "string" || playerId.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_player",
        message: "A stat-leader pick must include playerId.",
      },
    };
  }
  // No tournament-level player pool exists to validate against (doc 03
  // §2.1's Tournament shape is teams only) — the DB layer is responsible for
  // rejecting unknown players before picks reach the engine.
  return { ok: true, value: true };
}

/** Every playerId tied for the top value in this stat category, if reported yet. */
function tiedLeaders(question: Question, results: ResultSet): Set<string> | undefined {
  const statCategory = configStatCategory(question);
  if (statCategory === undefined) {
    return undefined;
  }
  const entries = results.statLeaders?.[statCategory];
  if (!entries || entries.length === 0) {
    return undefined;
  }
  const max = Math.max(...entries.map((entry) => entry.value));
  return new Set(entries.filter((entry) => entry.value === max).map((entry) => entry.playerId));
}

function resolve(question: Question, answer: Answer, results: ResultSet): ResolvedAnswer {
  const pickedPlayerId = answer.playerId;
  if (!pickedPlayerId) {
    return {
      awarded: 0,
      status: "no_pick",
      explanation: "No pick submitted for this question.",
    };
  }

  const statCategory = configStatCategory(question);
  if (statCategory === undefined) {
    return {
      awarded: 0,
      status: "pending",
      explanation: "This question is misconfigured (missing config.statCategory).",
    };
  }

  const leaders = tiedLeaders(question, results);
  if (!leaders) {
    return {
      awarded: 0,
      status: "pending",
      explanation: `The ${statCategory} leader has not been determined yet.`,
    };
  }

  if (leaders.has(pickedPlayerId)) {
    const tieNote = leaders.size > 1 ? ` (tied with ${leaders.size - 1} other player(s))` : "";
    return {
      awarded: question.points,
      status: "correct",
      explanation: `You picked ${pickedPlayerId} to lead ${statCategory}${tieNote}. ${question.points} of ${question.points} points.`,
    };
  }

  return {
    awarded: 0,
    status: "incorrect",
    explanation: `You picked ${pickedPlayerId} to lead ${statCategory}. That wasn't the leader. 0 of ${question.points} points.`,
  };
}

function boldnessUnits(answer: Answer): string[] {
  return answer.playerId ? [answer.playerId] : [];
}

function correctUnitSet(question: Question, results: ResultSet): Set<string> {
  return tiedLeaders(question, results) ?? new Set();
}

export const statLeaderResolver: QuestionResolver = {
  type: "stat_leader",
  validate,
  resolve,
  boldnessUnits,
  correctUnitSet,
};
