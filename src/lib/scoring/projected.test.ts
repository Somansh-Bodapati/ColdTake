// Projected mode — doc 03 §2.5: "Identical logic, but results is derived
// from live_state rather than result: current league table substitutes for
// final table, current stat leaders substitute for final stat leaders.
// Questions that cannot be projected (e.g. a boolean question about a
// future event) return status pending, award 0, and are excluded from
// maxPossible displays."
//
// Per types.ts's ResultSet doc comment, projected mode does NOT get a
// different input shape: the caller builds the exact same ResultSet from
// live_state (current table/stat leaders) instead of from result rows, and
// passes `isProjected: true`. Every resolver already treats "no fact
// available in ResultSet" as `pending` (see boolean/champion/etc.'s
// `settled*`/`results.finalResult` checks) — that's exactly what happens
// naturally when a question can't be projected from mid-season state, so no
// resolver-level changes were needed. What projected mode adds is the
// maxPossible exclusion: index.ts's `scoreOneAnswer` now zeroes
// `maxPossible` for any `pending` breakdown when `isProjected` is true
// (settled mode's own mid-season pendings keep full maxPossible — the
// exclusion is specific to projected displays per §2.5).

import { describe, expect, it } from "vitest";
import { score } from "@/lib/scoring";
import type { Question, ResultSet, ScoringConfig, ScoringInput } from "@/lib/scoring/types";

const championQuestion: Question = {
  id: "q-champion",
  type: "champion",
  config: {},
  points: 30,
};

const topNQuestion: Question = {
  id: "q-top4",
  type: "top_n_unordered",
  config: { n: 4 },
  points: 20,
};

// A boolean question about something that only resolves at the very end of
// the season (e.g. "Will there be a Super Over in the final?") — doc 03
// §2.5's own example of a question that "cannot be projected" mid-season.
const futureBooleanQuestion: Question = {
  id: "q-super-over-final",
  type: "boolean",
  config: {},
  points: 10,
};

function baseConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return { boldPickEnabled: false, boldnessWeight: 1, ...overrides };
}

// Mid-season live_state-derived ResultSet: a current (not final) table and
// stat leaders substitute for the settled result rows, per §2.5. Note there
// is deliberately no entry for q-super-over-final in questionResults — the
// live table can't tell you whether the (not-yet-played) final will have a
// Super Over, so the caller has nothing to put there.
const liveStateResults: ResultSet = {
  finalTable: [
    { teamId: "mi", position: 1 },
    { teamId: "rr", position: 2 },
    { teamId: "csk", position: 3 },
    { teamId: "gt", position: 4 },
    { teamId: "rcb", position: 5 },
  ],
  // No finalResult (champion isn't decided mid-season) and no
  // questionResults entry for the future boolean question — both fall out
  // naturally as "cannot be projected" once fed through the resolvers.
};

describe("projected mode (doc 03 §2.5)", () => {
  it("scores a projectable question (current table) identically in shape to final mode", () => {
    const input: ScoringInput = {
      questions: [topNQuestion],
      picks: [
        { questionId: "q-top4", memberId: "m1", answer: { teamIds: ["mi", "rr", "csk", "gt"] } },
      ],
      results: liveStateResults,
      config: baseConfig(),
      memberIds: ["m1"],
      isProjected: true,
    };

    const output = score(input);
    const [standing] = output.standings;
    // Current table substitutes for final table — top_n_unordered resolves
    // against it exactly as it would against a settled finalTable.
    expect(standing.breakdown[0]).toMatchObject({
      awarded: 20,
      maxPossible: 20,
      status: "correct",
    });
  });

  it("marks a question that cannot be projected as pending, awarding zero", () => {
    // champion can't be projected from a mid-season table — no finalResult
    // is derivable from live_state, so the resolver falls back to pending
    // exactly as it would mid-settlement in final mode.
    const input: ScoringInput = {
      questions: [championQuestion],
      picks: [{ questionId: "q-champion", memberId: "m1", answer: { teamId: "rr" } }],
      results: liveStateResults,
      config: baseConfig(),
      memberIds: ["m1"],
      isProjected: true,
    };

    const output = score(input);
    expect(output.standings[0].breakdown[0]).toMatchObject({
      awarded: 0,
      status: "pending",
    });
  });

  it("excludes an unprojectable question's points from maxPossible, unlike the same pending status in final mode", () => {
    const buildInput = (isProjected: boolean): ScoringInput => ({
      questions: [futureBooleanQuestion],
      picks: [{ questionId: "q-super-over-final", memberId: "m1", answer: { bool: true } }],
      // No questionResults entry either way — this question is genuinely
      // unsettled/unprojectable in both modes here, isolating the
      // maxPossible-exclusion behavior to the isProjected flag alone.
      results: liveStateResults,
      config: baseConfig(),
      memberIds: ["m1"],
      isProjected,
    });

    const projected = score(buildInput(true)).standings[0].breakdown[0];
    const final = score(buildInput(false)).standings[0].breakdown[0];

    // Same underlying pending resolution either way...
    expect(projected.status).toBe("pending");
    expect(final.status).toBe("pending");
    expect(projected.awarded).toBe(0);
    expect(final.awarded).toBe(0);

    // ...but doc 03 §2.5: only projected mode excludes it from maxPossible.
    expect(projected.maxPossible).toBe(0);
    expect(final.maxPossible).toBe(10);
  });

  it("excludes a projected-pending question from a member's total maxPossible across a mixed slate", () => {
    // One projectable question (scores normally) plus one unprojectable
    // question (pending, excluded) — the member's summed maxPossible should
    // reflect only the projectable question's points.
    const input: ScoringInput = {
      questions: [topNQuestion, futureBooleanQuestion],
      picks: [
        { questionId: "q-top4", memberId: "m1", answer: { teamIds: ["mi", "rr", "csk", "gt"] } },
        { questionId: "q-super-over-final", memberId: "m1", answer: { bool: true } },
      ],
      results: liveStateResults,
      config: baseConfig(),
      memberIds: ["m1"],
      isProjected: true,
    };

    const output = score(input);
    const [standing] = output.standings;
    const totalMaxPossible = standing.breakdown.reduce((sum, b) => sum + b.maxPossible, 0);

    expect(totalMaxPossible).toBe(20); // top4's 20 only; the pending boolean's 10 is excluded
    expect(standing.breakdown.find((b) => b.questionId === "q-super-over-final")).toMatchObject({
      status: "pending",
      maxPossible: 0,
    });
  });

  it("still resolves a settled admin fact through questionResults when live_state supplies one for a normally-unprojectable type", () => {
    // Not every boolean question is unprojectable mid-season — e.g. "Will
    // the group's #1 seed reach the final?" could genuinely be known partway
    // through. When the caller *can* derive a questionResults entry from
    // live_state, projected mode scores it exactly like final mode would.
    const midSeasonKnownBoolean: Question = {
      id: "q-top-seed-through",
      type: "boolean",
      config: {},
      points: 10,
    };
    const resultsWithKnownFact: ResultSet = {
      ...liveStateResults,
      questionResults: { "q-top-seed-through": { bool: true } },
    };

    const input: ScoringInput = {
      questions: [midSeasonKnownBoolean],
      picks: [{ questionId: "q-top-seed-through", memberId: "m1", answer: { bool: true } }],
      results: resultsWithKnownFact,
      config: baseConfig(),
      memberIds: ["m1"],
      isProjected: true,
    };

    const output = score(input);
    expect(output.standings[0].breakdown[0]).toMatchObject({
      awarded: 10,
      maxPossible: 10,
      status: "correct",
    });
  });
});
