// team_over_under resolver — doc 03 §2.3: "Correct if the team's final
// position satisfies the comparison in config."
//
// The proposition (which team, what threshold, which direction) lives
// entirely in config; the member's pick is a yes/no on whether it holds —
// the same { bool } shape as `boolean`, per doc 03's answer union
// (`{ bool: true }`). "over"/"under" here compares the team's final
// position number: "under" is true when position < threshold (finished
// better than it), "over" is true when position > threshold (finished
// worse than it) — position 1 is first place.
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

type Comparison = "over" | "under";

interface OverUnderConfig {
  teamId: string;
  threshold: number;
  comparison: Comparison;
}

function readConfig(question: Question): OverUnderConfig | undefined {
  const { teamId, threshold, comparison } = question.config;
  if (
    typeof teamId !== "string" ||
    teamId.length === 0 ||
    typeof threshold !== "number" ||
    (comparison !== "over" && comparison !== "under")
  ) {
    return undefined;
  }
  return { teamId, threshold, comparison };
}

function validate(
  answer: unknown,
  question: Question,
  tournament: Tournament
): ValidationResult {
  const config = readConfig(question);
  if (!config) {
    return {
      ok: false,
      error: {
        code: "invalid_config",
        message: "Question config must include teamId, threshold, and comparison ('over' | 'under').",
      },
    };
  }
  if (!tournament.teamIds.includes(config.teamId)) {
    return {
      ok: false,
      error: {
        code: "unknown_team",
        message: `"${config.teamId}" is not a team in this tournament.`,
      },
    };
  }
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
        message: "A team over/under pick must include a boolean answer.",
      },
    };
  }
  return { ok: true, value: true };
}

/** Whether the configured proposition actually held, once the team's final position is known. */
function actualOutcome(question: Question, results: ResultSet): boolean | undefined {
  const config = readConfig(question);
  if (!config || !results.finalTable) {
    return undefined;
  }
  const row = results.finalTable.find((r) => r.teamId === config.teamId);
  if (!row) {
    return undefined;
  }
  return config.comparison === "over" ? row.position > config.threshold : row.position < config.threshold;
}

function resolve(question: Question, answer: Answer, results: ResultSet): ResolvedAnswer {
  if (typeof answer.bool !== "boolean") {
    return {
      awarded: 0,
      status: "no_pick",
      explanation: "No pick submitted for this question.",
    };
  }

  const outcome = actualOutcome(question, results);
  if (outcome === undefined) {
    return {
      awarded: 0,
      status: "pending",
      explanation: "The team's final position is not available yet.",
    };
  }

  if (answer.bool === outcome) {
    return {
      awarded: question.points,
      status: "correct",
      explanation: `You said ${answer.bool ? "yes" : "no"}. The proposition was ${outcome ? "true" : "false"}. ${question.points} of ${question.points} points.`,
    };
  }

  return {
    awarded: 0,
    status: "incorrect",
    explanation: `You said ${answer.bool ? "yes" : "no"}. The proposition was ${outcome ? "true" : "false"}. 0 of ${question.points} points.`,
  };
}

function boldnessUnits(answer: Answer): string[] {
  return typeof answer.bool === "boolean" ? [answer.bool ? "yes" : "no"] : [];
}

function correctUnitSet(question: Question, results: ResultSet): Set<string> {
  const outcome = actualOutcome(question, results);
  return outcome === undefined ? new Set() : new Set([outcome ? "yes" : "no"]);
}

export const teamOverUnderResolver: QuestionResolver = {
  type: "team_over_under",
  validate,
  resolve,
  boldnessUnits,
  correctUnitSet,
};
