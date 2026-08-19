// Scoring engine entry point — doc 03 §2.1's `score()`. This is the
// engine's orchestrator module, not a re-export barrel: it owns the actual
// top-level function and wires the built-in resolvers into a registry.
// Pure: no I/O, no Date.now(), no DB access (CLAUDE.md rule 1) — every
// input (questions, picks, results, config, the frozen member snapshot) is
// a function argument.

import { applyBoldness, computeShare } from "@/lib/scoring/boldness";
import { createResolverRegistry } from "@/lib/scoring/registry";
import { booleanResolver } from "@/lib/scoring/resolvers/boolean";
import { championResolver } from "@/lib/scoring/resolvers/champion";
import { customResolver } from "@/lib/scoring/resolvers/custom";
import { numericResolver } from "@/lib/scoring/resolvers/numeric";
import { runnerUpResolver } from "@/lib/scoring/resolvers/runner-up";
import { statLeaderResolver } from "@/lib/scoring/resolvers/stat-leader";
import { teamOverUnderResolver } from "@/lib/scoring/resolvers/team-over-under";
import { topNOrderedResolver } from "@/lib/scoring/resolvers/top-n-ordered";
import { topNUnorderedResolver } from "@/lib/scoring/resolvers/top-n-unordered";
import { woodenSpoonResolver } from "@/lib/scoring/resolvers/wooden-spoon";
import type {
  Answer,
  MemberStanding,
  Pick,
  QuestionBreakdown,
  QuestionResolver,
  ResolvedAnswer,
  ResultSet,
  ScoringInput,
  ScoringOutput,
} from "@/lib/scoring/types";

const resolverRegistry = createResolverRegistry([
  championResolver,
  runnerUpResolver,
  topNUnorderedResolver,
  topNOrderedResolver,
  woodenSpoonResolver,
  statLeaderResolver,
  teamOverUnderResolver,
  numericResolver,
  booleanResolver,
  customResolver,
]);

function picksByQuestionId(picks: readonly Pick[]): Map<string, Map<string, Pick>> {
  const map = new Map<string, Map<string, Pick>>();
  for (const pick of picks) {
    let byMember = map.get(pick.questionId);
    if (!byMember) {
      byMember = new Map();
      map.set(pick.questionId, byMember);
    }
    byMember.set(pick.memberId, pick);
  }
  return map;
}

/**
 * Scores every question in `input` for every member in the frozen
 * memberIds snapshot, applying the bold-pick multiplier (doc 03 §2.4) when
 * `config.boldPickEnabled` is set. Identical logic serves both settled and
 * projected mode (§2.5) — the caller is responsible for building `results`
 * from `result` rows or `live_state` respectively; `isProjected` is purely
 * informational passthrough for the caller/UI.
 */
export function score(input: ScoringInput): ScoringOutput {
  const memberIdSet = new Set(input.memberIds);
  const picksByQuestion = picksByQuestionId(input.picks);
  const breakdownsByMember = new Map<string, QuestionBreakdown[]>(
    input.memberIds.map((memberId) => [memberId, []])
  );

  for (const question of input.questions) {
    const resolverResult = resolverRegistry.get(question.type);
    const resolver: QuestionResolver | undefined = resolverResult.ok
      ? resolverResult.value
      : undefined;

    // Only picks from members in the frozen snapshot count — doc 01 §4.3:
    // a member who joins after lock "can view but not pick; scores zero;
    // excluded from boldness denominator."
    const eligiblePicks = new Map<string, Pick>();
    for (const [memberId, pick] of picksByQuestion.get(question.id) ?? []) {
      if (memberIdSet.has(memberId)) {
        eligiblePicks.set(memberId, pick);
      }
    }

    const correctUnitSet = resolver?.correctUnitSet?.(question, input.results);
    const unitsByMember = new Map<string, string[]>();
    if (resolver?.boldnessUnits) {
      for (const [memberId, pick] of eligiblePicks) {
        unitsByMember.set(memberId, resolver.boldnessUnits(pick.answer));
      }
    }
    const shareForUnit = (unit: string) => computeShare(unit, unitsByMember);

    // Computed once per question, not per member — see `resolveGroup`'s doc
    // comment in types.ts. Only `numeric` currently uses this.
    let groupResolved: ReadonlyMap<string, ResolvedAnswer> | undefined;
    if (resolver?.resolveGroup) {
      const answersByMember = new Map<string, Answer>();
      for (const [memberId, pick] of eligiblePicks) {
        answersByMember.set(memberId, pick.answer);
      }
      groupResolved = resolver.resolveGroup(question, answersByMember, input.results);
    }

    for (const memberId of input.memberIds) {
      const pick = eligiblePicks.get(memberId);
      const entry = scoreOneAnswer({
        question,
        resolver,
        pick,
        results: input.results,
        boldPickEnabled: input.config.boldPickEnabled,
        boldnessWeight: input.config.boldnessWeight,
        correctUnitSet,
        shareForUnit,
        preResolved: groupResolved?.get(memberId),
      });
      breakdownsByMember.get(memberId)?.push(entry);
    }
  }

  return { standings: rankStandings(input.memberIds, breakdownsByMember) };
}

function scoreOneAnswer(params: {
  question: ScoringInput["questions"][number];
  resolver: QuestionResolver | undefined;
  pick: Pick | undefined;
  results: ResultSet;
  boldPickEnabled: boolean;
  boldnessWeight: number;
  correctUnitSet: Set<string> | undefined;
  shareForUnit: (unit: string) => number;
  /** Pre-computed by `resolver.resolveGroup`, if the resolver has one. */
  preResolved: ResolvedAnswer | undefined;
}): QuestionBreakdown {
  const {
    question,
    resolver,
    pick,
    results,
    boldPickEnabled,
    boldnessWeight,
    correctUnitSet,
    shareForUnit,
    preResolved,
  } = params;

  if (!resolver) {
    return {
      questionId: question.id,
      awarded: 0,
      maxPossible: question.points,
      status: "pending",
      boldnessMultiplier: 1,
      explanation: `No resolver registered for question type "${question.type}".`,
    };
  }

  if (!pick) {
    return {
      questionId: question.id,
      awarded: 0,
      maxPossible: question.points,
      status: "no_pick",
      boldnessMultiplier: 1,
      explanation: "No pick submitted for this question.",
    };
  }

  const base = preResolved ?? resolver.resolve(question, pick.answer, results);

  let awarded = base.awarded;
  let multiplier = 1;
  const canApplyBoldness =
    boldPickEnabled &&
    (base.status === "correct" || base.status === "partial") &&
    resolver.boldnessUnits &&
    correctUnitSet;

  if (canApplyBoldness) {
    const correctUnits = resolver
      .boldnessUnits!(pick.answer)
      .filter((unit) => correctUnitSet!.has(unit));
    const applied = applyBoldness(base.awarded, correctUnits, shareForUnit, boldnessWeight);
    awarded = applied.awarded;
    multiplier = applied.multiplier;
  }

  return {
    questionId: question.id,
    awarded,
    maxPossible: question.points,
    status: base.status,
    boldnessMultiplier: multiplier,
    explanation: base.explanation,
  };
}

function rankStandings(
  memberIds: readonly string[],
  breakdownsByMember: Map<string, QuestionBreakdown[]>
): MemberStanding[] {
  const standings = memberIds.map((memberId) => {
    const breakdown = breakdownsByMember.get(memberId) ?? [];
    const points = breakdown.reduce((sum, entry) => sum + entry.awarded, 0);
    return { memberId, points, breakdown, rank: 0 };
  });

  standings.sort((a, b) => b.points - a.points);

  let rank = 0;
  let previousPoints: number | null = null;
  for (const [index, standing] of standings.entries()) {
    if (standing.points !== previousPoints) {
      rank = index + 1;
      previousPoints = standing.points;
    }
    standing.rank = rank;
  }

  return standings;
}
