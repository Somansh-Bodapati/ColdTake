import { describe, expect, it } from "vitest";
import { score } from "@/lib/scoring";
import type { QuestionType } from "@/lib/db/schema";
import type { Question, ResultSet, ScoringConfig, ScoringInput } from "@/lib/scoring/types";

const championQuestion: Question = {
  id: "q-champion",
  type: "champion",
  config: {},
  points: 25,
};

const topNQuestion: Question = {
  id: "q-top4",
  type: "top_n_unordered",
  config: { n: 4 },
  points: 20,
};

const results: ResultSet = {
  finalResult: { championTeamId: "rr" },
  finalTable: [
    { teamId: "mi", position: 1 },
    { teamId: "rr", position: 2 },
    { teamId: "csk", position: 3 },
    { teamId: "gt", position: 4 },
    { teamId: "rcb", position: 5 },
  ],
};

function baseConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return { boldPickEnabled: false, boldnessWeight: 1, ...overrides };
}

describe("score", () => {
  it("scores a straightforward multi-question, multi-member season", () => {
    const input: ScoringInput = {
      questions: [championQuestion, topNQuestion],
      picks: [
        { questionId: "q-champion", memberId: "m1", answer: { teamId: "rr" } },
        { questionId: "q-champion", memberId: "m2", answer: { teamId: "mi" } },
        { questionId: "q-top4", memberId: "m1", answer: { teamIds: ["mi", "rr", "csk", "gt"] } },
        { questionId: "q-top4", memberId: "m2", answer: { teamIds: ["mi", "rr", "rcb", "gt"] } },
      ],
      results,
      config: baseConfig(),
      memberIds: ["m1", "m2"],
      isProjected: false,
    };

    const output = score(input);
    const m1 = output.standings.find((s) => s.memberId === "m1")!;
    const m2 = output.standings.find((s) => s.memberId === "m2")!;

    expect(m1.points).toBe(45); // 25 + 20
    expect(m2.points).toBe(15); // 0 + 15 (3 of 4 correct)
    expect(m1.rank).toBe(1);
    expect(m2.rank).toBe(2);
  });

  // doc 01 §4.3: "Member submits an incomplete slate — unanswered questions
  // score zero; no penalty beyond that."
  it("scores an unanswered question as no_pick with zero points and no penalty", () => {
    const input: ScoringInput = {
      questions: [championQuestion],
      picks: [],
      results,
      config: baseConfig(),
      memberIds: ["m1"],
      isProjected: false,
    };

    const output = score(input);
    const [standing] = output.standings;
    expect(standing.points).toBe(0);
    expect(standing.breakdown[0].status).toBe("no_pick");
  });

  // doc 01 §4.3: "Member joins after lock — can view but not pick; scores
  // zero; excluded from boldness denominator." memberIds is the frozen
  // snapshot, so a pick from someone outside it must be ignored entirely.
  it("ignores picks from members outside the frozen memberIds snapshot", () => {
    const input: ScoringInput = {
      questions: [championQuestion],
      picks: [
        { questionId: "q-champion", memberId: "m1", answer: { teamId: "rr" } },
        { questionId: "q-champion", memberId: "late-joiner", answer: { teamId: "rr" } },
      ],
      results,
      config: baseConfig(),
      memberIds: ["m1"],
      isProjected: false,
    };

    const output = score(input);
    expect(output.standings).toHaveLength(1);
    expect(output.standings[0].memberId).toBe("m1");
  });

  it("marks a question pending, awarding zero, when a resolver isn't registered for its type", () => {
    // Every real QuestionType now has a registered resolver, so this
    // exercises the registry-miss path with a type that deliberately isn't
    // one of them, rather than depending on a specific type staying
    // unregistered forever.
    const unregisteredType = "not_a_real_question_type" as QuestionType;
    const input: ScoringInput = {
      questions: [{ id: "q-unregistered", type: unregisteredType, config: {}, points: 10 }],
      picks: [{ questionId: "q-unregistered", memberId: "m1", answer: { value: 500 } }],
      results,
      config: baseConfig(),
      memberIds: ["m1"],
      isProjected: false,
    };

    const output = score(input);
    expect(output.standings[0].breakdown[0]).toMatchObject({ awarded: 0, status: "pending" });
  });

  describe("bold-pick multiplier (doc 03 §2.4)", () => {
    it("applies no multiplier when every picker agreed (share = 1)", () => {
      const input: ScoringInput = {
        questions: [championQuestion],
        picks: [
          { questionId: "q-champion", memberId: "m1", answer: { teamId: "rr" } },
          { questionId: "q-champion", memberId: "m2", answer: { teamId: "rr" } },
        ],
        results,
        config: baseConfig({ boldPickEnabled: true }),
        memberIds: ["m1", "m2"],
        isProjected: false,
      };

      const output = score(input);
      const m1 = output.standings.find((s) => s.memberId === "m1")!;
      expect(m1.breakdown[0].awarded).toBe(25);
      expect(m1.breakdown[0].boldnessMultiplier).toBe(1);
    });

    it("rewards the lone correct picker with a higher multiplier", () => {
      const input: ScoringInput = {
        questions: [championQuestion],
        picks: [
          { questionId: "q-champion", memberId: "m1", answer: { teamId: "rr" } },
          { questionId: "q-champion", memberId: "m2", answer: { teamId: "mi" } },
          { questionId: "q-champion", memberId: "m3", answer: { teamId: "mi" } },
          { questionId: "q-champion", memberId: "m4", answer: { teamId: "mi" } },
        ],
        results,
        config: baseConfig({ boldPickEnabled: true }),
        memberIds: ["m1", "m2", "m3", "m4"],
        isProjected: false,
      };

      const output = score(input);
      const m1 = output.standings.find((s) => s.memberId === "m1")!;
      // share = 1/4, boldness = 3/4, multiplier = 1.75, 25*1.75 = 43.75 -> 43
      expect(m1.breakdown[0].awarded).toBe(43);
      expect(m1.breakdown[0].boldnessMultiplier).toBeCloseTo(1.75);
    });

    it("never applies a multiplier to a wrong pick", () => {
      const input: ScoringInput = {
        questions: [championQuestion],
        picks: [{ questionId: "q-champion", memberId: "m1", answer: { teamId: "mi" } }],
        results,
        config: baseConfig({ boldPickEnabled: true }),
        memberIds: ["m1"],
        isProjected: false,
      };

      const output = score(input);
      expect(output.standings[0].breakdown[0]).toMatchObject({
        awarded: 0,
        boldnessMultiplier: 1,
      });
    });

    // doc 03 §2.4: single-member groups can't be bold relative to anyone.
    it("applies no multiplier in a single-member group", () => {
      const input: ScoringInput = {
        questions: [championQuestion],
        picks: [{ questionId: "q-champion", memberId: "solo", answer: { teamId: "rr" } }],
        results,
        config: baseConfig({ boldPickEnabled: true }),
        memberIds: ["solo"],
        isProjected: false,
      };

      const output = score(input);
      expect(output.standings[0].breakdown[0]).toMatchObject({
        awarded: 25,
        boldnessMultiplier: 1,
      });
    });

    it("leaves scores untouched when boldPickEnabled is false", () => {
      const input: ScoringInput = {
        questions: [championQuestion],
        picks: [
          { questionId: "q-champion", memberId: "m1", answer: { teamId: "rr" } },
          { questionId: "q-champion", memberId: "m2", answer: { teamId: "mi" } },
        ],
        results,
        config: baseConfig({ boldPickEnabled: false }),
        memberIds: ["m1", "m2"],
        isProjected: false,
      };

      const output = score(input);
      const m1 = output.standings.find((s) => s.memberId === "m1")!;
      expect(m1.breakdown[0]).toMatchObject({ awarded: 25, boldnessMultiplier: 1 });
    });

    // doc 03 §2.4: "for top_n_*, compute boldness per team within the answer".
    it("computes top_n_unordered boldness per team, not per whole answer", () => {
      const input: ScoringInput = {
        questions: [topNQuestion],
        picks: [
          // m1 shares 3 of 4 teams with m2 but picks "gt" alone.
          { questionId: "q-top4", memberId: "m1", answer: { teamIds: ["mi", "rr", "csk", "gt"] } },
          { questionId: "q-top4", memberId: "m2", answer: { teamIds: ["mi", "rr", "csk", "rcb"] } },
        ],
        results,
        config: baseConfig({ boldPickEnabled: true }),
        memberIds: ["m1", "m2"],
        isProjected: false,
      };

      const output = score(input);
      const m1 = output.standings.find((s) => s.memberId === "m1")!;
      // mi, rr, csk shared (share 1, multiplier 1) worth 5 each = 15.
      // gt picked alone (share 1/2, multiplier 1.5) worth 5*1.5 = 7.5.
      // total 22.5 -> floors to 22.
      expect(m1.breakdown[0].awarded).toBe(22);
    });

    // doc 03 §2.4: "For numeric, boldness does not apply (there's no
    // meaningful 'share')." Prove it end-to-end through the orchestrator: a
    // numeric pick that's a lone (maximally "bold") correct guess still
    // comes out with multiplier 1 and unboosted points.
    it("never applies the boldness multiplier to a numeric pick, however bold", () => {
      const numericQuestion: Question = {
        id: "q-numeric",
        type: "numeric",
        config: {},
        points: 10,
      };
      const input: ScoringInput = {
        questions: [numericQuestion],
        picks: [
          // m1 is the lone closest guess by a wide margin - the "boldest"
          // possible numeric pick - while m2's guess isn't close to anyone.
          { questionId: "q-numeric", memberId: "m1", answer: { value: 700 } },
          { questionId: "q-numeric", memberId: "m2", answer: { value: 0 } },
        ],
        results: { questionResults: { "q-numeric": { value: 700 } } },
        config: baseConfig({ boldPickEnabled: true }),
        memberIds: ["m1", "m2"],
        isProjected: false,
      };

      const output = score(input);
      const m1 = output.standings.find((s) => s.memberId === "m1")!;
      expect(m1.breakdown[0]).toMatchObject({
        awarded: 10,
        status: "correct",
        boldnessMultiplier: 1,
      });
    });
  });
});
