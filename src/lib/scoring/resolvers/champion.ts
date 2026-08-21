// champion resolver — doc 03 §2.3: "Exact match on winning team → full points."
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
        message: "A champion pick must include teamId.",
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

function resolve(question: Question, answer: Answer, results: ResultSet): ResolvedAnswer {
  const pickedTeamId = answer.teamId;
  if (!pickedTeamId) {
    return {
      awarded: 0,
      status: "no_pick",
      explanation: "No pick submitted for this question.",
    };
  }

  const championTeamId = results.finalResult?.championTeamId;
  if (!championTeamId) {
    return {
      awarded: 0,
      status: "pending",
      explanation: "The champion has not been determined yet.",
    };
  }

  if (pickedTeamId === championTeamId) {
    return {
      awarded: question.points,
      status: "correct",
      explanation: `You picked ${pickedTeamId} for champion. ${championTeamId} won. ${question.points} of ${question.points} points.`,
    };
  }

  return {
    awarded: 0,
    status: "incorrect",
    explanation: `You picked ${pickedTeamId} for champion. ${championTeamId} won. 0 of ${question.points} points.`,
  };
}

function boldnessUnits(answer: Answer): string[] {
  return answer.teamId ? [answer.teamId] : [];
}

function correctUnitSet(_question: Question, results: ResultSet): Set<string> {
  const championTeamId = results.finalResult?.championTeamId;
  return championTeamId ? new Set([championTeamId]) : new Set();
}

export const championResolver: QuestionResolver = {
  type: "champion",
  validate,
  resolve,
  boldnessUnits,
  correctUnitSet,
};
