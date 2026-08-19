// top_n_ordered resolver — doc 03 §2.3: "points × (correctPositions / n),
// plus config.exactBonus if all positions match."
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

function configN(question: Question): number | undefined {
  const n = question.config.n;
  return typeof n === "number" && n > 0 ? n : undefined;
}

function configExactBonus(question: Question): number {
  const bonus = question.config.exactBonus;
  return typeof bonus === "number" ? bonus : 0;
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

/** Position -> teamId for the top n rows of the final table, if available. */
function topNPositions(question: Question, results: ResultSet): Map<number, string> | undefined {
  const n = configN(question);
  if (n === undefined || !results.finalTable) {
    return undefined;
  }
  const byPosition = new Map<number, string>();
  for (const row of results.finalTable) {
    if (row.position <= n) {
      byPosition.set(row.position, row.teamId);
    }
  }
  return byPosition;
}

function topNTeamIds(question: Question, results: ResultSet): Set<string> | undefined {
  const byPosition = topNPositions(question, results);
  return byPosition ? new Set(byPosition.values()) : undefined;
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

  const byPosition = topNPositions(question, results);
  if (!byPosition) {
    return {
      awarded: 0,
      status: "pending",
      explanation: "The final standings are not available yet.",
    };
  }

  // Trusts a validated answer (exactly n, no duplicates) but clamps
  // defensively rather than letting a malformed pick overshoot points.
  let correctPositions = 0;
  for (let i = 0; i < Math.min(pickedTeamIds.length, n); i++) {
    if (byPosition.get(i + 1) === pickedTeamIds[i]) {
      correctPositions += 1;
    }
  }

  const basePoints = Math.floor((question.points * correctPositions) / n);
  const exactBonus = correctPositions === n ? configExactBonus(question) : 0;
  const awarded = basePoints + exactBonus;
  const status = correctPositions === n ? "correct" : correctPositions > 0 ? "partial" : "incorrect";

  return {
    awarded,
    status,
    explanation:
      exactBonus > 0
        ? `You picked ${correctPositions} of ${n} positions exactly right, plus a ${exactBonus}-point bonus for a perfect order. ${awarded} of ${question.points + exactBonus} points.`
        : `You picked ${correctPositions} of ${n} positions exactly right. ${awarded} of ${question.points} points.`,
  };
}

// doc 03 §2.4: "for top_n_*, compute boldness per team within the answer" —
// membership in the top-n set, same mechanism as top_n_unordered. Position
// isn't part of the unit: a team picked in the wrong slot but still inside
// the top n is still a "bold" claim on that team finishing there.
function boldnessUnits(answer: Answer): string[] {
  return answer.teamIds ?? [];
}

function correctUnitSet(question: Question, results: ResultSet): Set<string> {
  return topNTeamIds(question, results) ?? new Set();
}

export const topNOrderedResolver: QuestionResolver = {
  type: "top_n_ordered",
  validate,
  resolve,
  boldnessUnits,
  correctUnitSet,
};
