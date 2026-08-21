// boolean resolver — doc 03 §2.3: "Exact match." A generic yes/no question
// with no derivable tournament fact (unlike champion/wooden_spoon/etc.), so
// the settled value comes from the caller's manual-settlement input,
// `results.questionResults[question.id]` — see types.ts's ResultSet doc.
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
  _tournament: Tournament
): ValidationResult {
  if (typeof answer !== "object" || answer === null) {
    return {
      ok: false,
      error: { code: "invalid_shape", message: "Answer must be an object." },
    };
  }
  if (typeof (answer as Answer).bool !== "boolean") {
    return {
      ok: false,
      error: {
        code: "missing_bool",
        message: "A boolean pick must include a boolean answer.",
      },
    };
  }
  return { ok: true, value: true };
}

function settledBool(question: Question, results: ResultSet): boolean | undefined {
  return results.questionResults?.[question.id]?.bool;
}

function resolve(question: Question, answer: Answer, results: ResultSet): ResolvedAnswer {
  if (typeof answer.bool !== "boolean") {
    return {
      awarded: 0,
      status: "no_pick",
      explanation: "No pick submitted for this question.",
    };
  }

  const actual = settledBool(question, results);
  if (actual === undefined) {
    return {
      awarded: 0,
      status: "pending",
      explanation: "This question has not been settled yet.",
    };
  }

  if (answer.bool === actual) {
    return {
      awarded: question.points,
      status: "correct",
      explanation: `You said ${answer.bool ? "yes" : "no"}. The answer was ${actual ? "yes" : "no"}. ${question.points} of ${question.points} points.`,
    };
  }

  return {
    awarded: 0,
    status: "incorrect",
    explanation: `You said ${answer.bool ? "yes" : "no"}. The answer was ${actual ? "yes" : "no"}. 0 of ${question.points} points.`,
  };
}

function boldnessUnits(answer: Answer): string[] {
  return typeof answer.bool === "boolean" ? [answer.bool ? "yes" : "no"] : [];
}

function correctUnitSet(question: Question, results: ResultSet): Set<string> {
  const actual = settledBool(question, results);
  return actual === undefined ? new Set() : new Set([actual ? "yes" : "no"]);
}

export const booleanResolver: QuestionResolver = {
  type: "boolean",
  validate,
  resolve,
  boldnessUnits,
  correctUnitSet,
};
