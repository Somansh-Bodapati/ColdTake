// custom resolver — doc 03 §2.3: "Exact match against the admin-settled
// option ID." Like `boolean`, the settled value isn't derivable from
// finalTable/finalResult/statLeaders — it comes from the caller's manual
// settlement input, `results.questionResults[question.id]`.
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

function configOptionIds(question: Question): Set<string> | undefined {
  const options = question.config.options;
  if (!Array.isArray(options) || options.length === 0) {
    return undefined;
  }
  return new Set(options.map((option) => option.id));
}

function validate(
  answer: unknown,
  question: Question,
  _tournament: Tournament
): ValidationResult {
  const optionIds = configOptionIds(question);
  if (!optionIds) {
    return {
      ok: false,
      error: {
        code: "invalid_config",
        message: "Question config.options must be a non-empty array.",
      },
    };
  }
  if (typeof answer !== "object" || answer === null) {
    return {
      ok: false,
      error: { code: "invalid_shape", message: "Answer must be an object." },
    };
  }
  const optionId = (answer as Answer).optionId;
  if (typeof optionId !== "string" || optionId.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_option",
        message: "A custom pick must include optionId.",
      },
    };
  }
  if (!optionIds.has(optionId)) {
    return {
      ok: false,
      error: {
        code: "unknown_option",
        message: `"${optionId}" is not one of this question's options.`,
      },
    };
  }
  return { ok: true, value: true };
}

function settledOptionId(question: Question, results: ResultSet): string | undefined {
  return results.questionResults?.[question.id]?.optionId;
}

function resolve(question: Question, answer: Answer, results: ResultSet): ResolvedAnswer {
  const pickedOptionId = answer.optionId;
  if (!pickedOptionId) {
    return {
      awarded: 0,
      status: "no_pick",
      explanation: "No pick submitted for this question.",
    };
  }

  const actual = settledOptionId(question, results);
  if (!actual) {
    return {
      awarded: 0,
      status: "pending",
      explanation: "This question has not been settled yet.",
    };
  }

  if (pickedOptionId === actual) {
    return {
      awarded: question.points,
      status: "correct",
      explanation: `You picked "${pickedOptionId}". The settled answer was "${actual}". ${question.points} of ${question.points} points.`,
    };
  }

  return {
    awarded: 0,
    status: "incorrect",
    explanation: `You picked "${pickedOptionId}". The settled answer was "${actual}". 0 of ${question.points} points.`,
  };
}

function boldnessUnits(answer: Answer): string[] {
  return answer.optionId ? [answer.optionId] : [];
}

function correctUnitSet(question: Question, results: ResultSet): Set<string> {
  const actual = settledOptionId(question, results);
  return actual ? new Set([actual]) : new Set();
}

export const customResolver: QuestionResolver = {
  type: "custom",
  validate,
  resolve,
  boldnessUnits,
  correctUnitSet,
};
