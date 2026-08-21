// numeric resolver — doc 03 §2.3: "Ranked by absolute distance from the
// actual value. Closest gets points, second gets points ×
// config.secondPlaceRatio (default 0.5). Ties split equally, rounded down."
// The settled actual value isn't derivable from finalTable/finalResult/
// statLeaders (a "numeric guess" is a season aggregate — doc 01 §3's Q10
// example, "total sixes in the tournament" — not a team or player fact), so
// like `boolean`/`custom` it comes from the caller's manual settlement
// input, `results.questionResults[question.id]`.
//
// This is the resolver `resolveGroup` exists for (see types.ts's doc
// comment): an award here is inherently relative to every other member's
// answer to the same question, not resolvable against a fixed target one
// member at a time. `resolve` is still implemented — the interface requires
// it, and it's useful for direct single-answer testing — by delegating to
// the same core ranking logic with a single-entry answer map; a lone answer
// is trivially "closest" by construction once the question is settled.
//
// doc 03 §2.4: "For numeric, boldness does not apply (there's no meaningful
// 'share')." This resolver deliberately omits `boldnessUnits` and
// `correctUnitSet` — index.ts's orchestrator only applies the multiplier
// when both are present, so leaving them out is what keeps a bold-flagged
// numeric pick from ever being multiplied.
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

function configSecondPlaceRatio(question: Question): number {
  const ratio = question.config.secondPlaceRatio;
  return typeof ratio === "number" ? ratio : 0.5;
}

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
  const value = (answer as Answer).value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      ok: false,
      error: {
        code: "missing_value",
        message: "A numeric pick must include a finite numeric value.",
      },
    };
  }
  return { ok: true, value: true };
}

function settledValue(question: Question, results: ResultSet): number | undefined {
  const value = results.questionResults?.[question.id]?.value;
  return typeof value === "number" ? value : undefined;
}

/**
 * Shared ranking core for `resolve` and `resolveGroup`: rank every member's
 * answer by absolute distance from the actual value, award the closest tier
 * `question.points` and the next-closest tier `question.points *
 * secondPlaceRatio`, splitting each tier's point pool evenly (floored)
 * across members tied within that tier. Members further than the
 * second-closest distance score zero.
 */
function resolveAll(
  question: Question,
  answers: ReadonlyMap<string, Answer>,
  results: ResultSet
): Map<string, ResolvedAnswer> {
  const resolved = new Map<string, ResolvedAnswer>();
  const actual = settledValue(question, results);

  const withValues: { memberId: string; value: number }[] = [];
  for (const [memberId, answer] of answers) {
    if (typeof answer.value !== "number" || !Number.isFinite(answer.value)) {
      resolved.set(memberId, {
        awarded: 0,
        status: "no_pick",
        explanation: "No pick submitted for this question.",
      });
      continue;
    }
    if (actual === undefined) {
      resolved.set(memberId, {
        awarded: 0,
        status: "pending",
        explanation: "This question has not been settled yet.",
      });
      continue;
    }
    withValues.push({ memberId, value: answer.value });
  }

  if (actual === undefined || withValues.length === 0) {
    return resolved;
  }

  const withDistances = withValues.map((entry) => ({
    ...entry,
    distance: Math.abs(entry.value - actual),
  }));

  const distinctDistances = [...new Set(withDistances.map((entry) => entry.distance))].sort(
    (a, b) => a - b
  );
  const closestDistance = distinctDistances[0];
  const secondDistance = distinctDistances.find((distance) => distance > closestDistance);

  const closestTier = withDistances.filter((entry) => entry.distance === closestDistance);
  const secondTier =
    secondDistance === undefined
      ? []
      : withDistances.filter((entry) => entry.distance === secondDistance);

  const closestAward = Math.floor(question.points / closestTier.length);
  for (const entry of closestTier) {
    resolved.set(entry.memberId, {
      awarded: closestAward,
      status: "correct",
      explanation: `Your guess of ${entry.value} was closest to the actual value of ${actual} (off by ${entry.distance}). ${closestAward} of ${question.points} points.`,
    });
  }

  if (secondTier.length > 0) {
    const secondPlacePool = question.points * configSecondPlaceRatio(question);
    const secondAward = Math.floor(secondPlacePool / secondTier.length);
    for (const entry of secondTier) {
      resolved.set(entry.memberId, {
        awarded: secondAward,
        status: "partial",
        explanation: `Your guess of ${entry.value} was second-closest to the actual value of ${actual} (off by ${entry.distance}). ${secondAward} of ${question.points} points.`,
      });
    }
  }

  for (const entry of withDistances) {
    if (!resolved.has(entry.memberId)) {
      resolved.set(entry.memberId, {
        awarded: 0,
        status: "incorrect",
        explanation: `Your guess of ${entry.value} was not among the closest to the actual value of ${actual}. 0 of ${question.points} points.`,
      });
    }
  }

  return resolved;
}

function resolve(question: Question, answer: Answer, results: ResultSet): ResolvedAnswer {
  const resolved = resolveAll(question, new Map([["_single", answer]]), results);
  return (
    resolved.get("_single") ?? {
      awarded: 0,
      status: "no_pick",
      explanation: "No pick submitted for this question.",
    }
  );
}

function resolveGroup(
  question: Question,
  answers: ReadonlyMap<string, Answer>,
  results: ResultSet
): ReadonlyMap<string, ResolvedAnswer> {
  return resolveAll(question, answers, results);
}

export const numericResolver: QuestionResolver = {
  type: "numeric",
  validate,
  resolve,
  resolveGroup,
};
