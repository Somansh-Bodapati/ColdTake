// top_n_unordered resolver — doc 03 §2.3: "points × (correctTeams / n),
// rounded down. Status partial if 0 < correct < n."
// Pure: no I/O, no Date.now(), no DB access (CLAUDE.md rule 1).

import type {
  Answer,
  Question,
  QuestionResolver,
  ResolvedAnswer,
  ResultSet,
  Tournament,
  ValidationResult,
} from "../types.js";

function configN(question: Question): number | undefined {
  const n = question.config.n;
  return typeof n === "number" && n > 0 ? n : undefined;
}

function validate(
  answer: unknown,
  question: Question,
  tournament: Tournament
): ValidationResult {
  const n = configN(question);
  if (n === undefined) {
    return {
      ok: false,
      error: {
        code: "invalid_config",
        message: "Question config.n must be a positive number.",
      },
    };
  }
  if (typeof answer !== "object" || answer === null) {
    return {
      ok: false,
      error: { code: "invalid_shape", message: "Answer must be an object." },
    };
  }
  const teamIds = (answer as Answer).teamIds;
  if (!Array.isArray(teamIds)) {
    return {
      ok: false,
      error: {
        code: "missing_teams",
        message: "A top-N pick must include teamIds.",
      },
    };
  }
  if (teamIds.length !== n) {
    return {
      ok: false,
      error: {
        code: "wrong_count",
        message: `Pick must include exactly ${n} teams.`,
      },
    };
  }
  // doc 01 §4.3: duplicates within a Top-N pick are rejected at validation.
  if (new Set(teamIds).size !== teamIds.length) {
    return {
      ok: false,
      error: {
        code: "duplicate_teams",
        message: "Pick may not include duplicate teams.",
      },
    };
  }
  for (const teamId of teamIds) {
    if (!tournament.teamIds.includes(teamId)) {
      return {
        ok: false,
        error: {
          code: "unknown_team",
          message: `"${teamId}" is not a team in this tournament.`,
        },
      };
    }
  }
  return { ok: true, value: true };
}

function topNTeamIds(question: Question, results: ResultSet): Set<string> | undefined {
  const n = configN(question);
  if (n === undefined || !results.finalTable) {
    return undefined;
  }
  return new Set(
    results.finalTable.filter((row) => row.position <= n).map((row) => row.teamId)
  );
}

function resolve(question: Question, answer: Answer, results: ResultSet): ResolvedAnswer {
  const pickedTeamIds = answer.teamIds;
  if (!pickedTeamIds || pickedTeamIds.length === 0) {
    return {
      awarded: 0,
      status: "no_pick",
      explanation: "No pick submitted for this question.",
    };
  }

  const n = configN(question);
  if (n === undefined) {
    return {
      awarded: 0,
      status: "pending",
      explanation: "This question is misconfigured (missing config.n).",
    };
  }

  const correctSet = topNTeamIds(question, results);
  if (!correctSet) {
    return {
      awarded: 0,
      status: "pending",
      explanation: "The final standings are not available yet.",
    };
  }

  // Trusts a validated answer (exactly n, no duplicates) but clamps
  // defensively rather than letting a malformed pick overshoot points.
  const correctCount = Math.min(
    pickedTeamIds.filter((teamId) => correctSet.has(teamId)).length,
    n
  );
  const awarded = Math.floor((question.points * correctCount) / n);
  const status = correctCount === n ? "correct" : correctCount > 0 ? "partial" : "incorrect";

  return {
    awarded,
    status,
    explanation: `You picked ${correctCount} of ${n} correct teams. ${awarded} of ${question.points} points.`,
  };
}

function boldnessUnits(answer: Answer): string[] {
  return answer.teamIds ?? [];
}

function correctUnitSet(question: Question, results: ResultSet): Set<string> {
  return topNTeamIds(question, results) ?? new Set();
}

export const topNUnorderedResolver: QuestionResolver = {
  type: "top_n_unordered",
  validate,
  resolve,
  boldnessUnits,
  correctUnitSet,
};
