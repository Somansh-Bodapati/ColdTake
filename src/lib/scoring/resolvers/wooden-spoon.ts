// wooden_spoon resolver — doc 03 §2.3: "Exact match on last-placed team."
// The last-placed team is derived from the final table's highest `position`
// value rather than a dedicated FinalResult field, matching how top_n_*
// derives its correct set from finalTable.
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

function validate(
  answer: unknown,
  _question: Question,
  tournament: Tournament
): ValidationResult {
  if (typeof answer !== "object" || answer === null) {
    return {
      ok: false,
      error: { code: "invalid_shape", message: "Answer must be an object." },
    };
  }
  const teamId = (answer as Answer).teamId;
  if (typeof teamId !== "string" || teamId.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_team",
        message: "A wooden-spoon pick must include teamId.",
      },
    };
  }
  if (!tournament.teamIds.includes(teamId)) {
    return {
      ok: false,
      error: {
        code: "unknown_team",
        message: `"${teamId}" is not a team in this tournament.`,
      },
    };
  }
  return { ok: true, value: true };
}

function lastPlacedTeamId(results: ResultSet): string | undefined {
  const finalTable = results.finalTable;
  if (!finalTable || finalTable.length === 0) {
    return undefined;
  }
  return finalTable.reduce((last, row) => (row.position > last.position ? row : last)).teamId;
}

function resolve(question: Question, answer: Answer, results: ResultSet): ResolvedAnswer {
  const pickedTeamId = answer.teamId;
  if (!pickedTeamId) {
    return {
      awarded: 0,
      status: "no_pick",
      explanation: "No pick submitted for this question.",
    };
  }

  const lastPlaced = lastPlacedTeamId(results);
  if (!lastPlaced) {
    return {
      awarded: 0,
      status: "pending",
      explanation: "The final standings are not available yet.",
    };
  }

  if (pickedTeamId === lastPlaced) {
    return {
      awarded: question.points,
      status: "correct",
      explanation: `You picked ${pickedTeamId} for the wooden spoon. ${lastPlaced} finished last. ${question.points} of ${question.points} points.`,
    };
  }

  return {
    awarded: 0,
    status: "incorrect",
    explanation: `You picked ${pickedTeamId} for the wooden spoon. ${lastPlaced} finished last. 0 of ${question.points} points.`,
  };
}

function boldnessUnits(answer: Answer): string[] {
  return answer.teamId ? [answer.teamId] : [];
}

function correctUnitSet(_question: Question, results: ResultSet): Set<string> {
  const lastPlaced = lastPlacedTeamId(results);
  return lastPlaced ? new Set([lastPlaced]) : new Set();
}

export const woodenSpoonResolver: QuestionResolver = {
  type: "wooden_spoon",
  validate,
  resolve,
  boldnessUnits,
  correctUnitSet,
};
