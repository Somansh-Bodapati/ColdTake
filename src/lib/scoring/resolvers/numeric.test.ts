import { describe, expect, it } from "vitest";
import type { Answer, Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { numericResolver } from "@/lib/scoring/resolvers/numeric";

const question: Question = {
  id: "q11",
  type: "numeric",
  config: {},
  points: 10,
};

// doc 01 §4.1: "Numeric guess — 10 to closest, 5 to second closest" -> ratio 0.5.
const customRatioQuestion: Question = {
  ...question,
  id: "q12",
  config: { secondPlaceRatio: 0.4 },
};

const tournament: Tournament = {
  id: "ipl-2027",
  teamIds: ["mi", "rr"],
};

const settled: ResultSet = { questionResults: { [question.id]: { value: 700 } } };

describe("numericResolver.validate", () => {
  it("accepts a finite numeric value", () => {
    expect(numericResolver.validate({ value: 640 }, question, tournament).ok).toBe(true);
  });

  it("rejects a missing value", () => {
    expect(numericResolver.validate({}, question, tournament).ok).toBe(false);
  });

  it("rejects a non-numeric value", () => {
    expect(numericResolver.validate({ value: "640" }, question, tournament).ok).toBe(false);
  });

  it("rejects a non-finite value", () => {
    expect(numericResolver.validate({ value: Infinity }, question, tournament).ok).toBe(false);
  });

  it("rejects a non-object answer", () => {
    expect(numericResolver.validate(640, question, tournament).ok).toBe(false);
  });
});

describe("numericResolver.resolveGroup", () => {
  it("awards full points to the single closest guess, ratio to the second closest", () => {
    const answers = new Map<string, Answer>([
      ["m1", { value: 700 }], // distance 0 -> closest
      ["m2", { value: 690 }], // distance 10 -> second
      ["m3", { value: 600 }], // distance 100 -> nothing
    ]);
    const resolved = numericResolver.resolveGroup!(question, answers, settled);

    expect(resolved.get("m1")).toMatchObject({ awarded: 10, status: "correct" });
    expect(resolved.get("m2")).toMatchObject({ awarded: 5, status: "partial" });
    expect(resolved.get("m3")).toMatchObject({ awarded: 0, status: "incorrect" });
  });

  it("uses config.secondPlaceRatio when provided", () => {
    const answers = new Map<string, Answer>([
      ["m1", { value: 700 }],
      ["m2", { value: 690 }],
    ]);
    const settledCustom: ResultSet = {
      questionResults: { [customRatioQuestion.id]: { value: 700 } },
    };
    const resolved = numericResolver.resolveGroup!(customRatioQuestion, answers, settledCustom);

    expect(resolved.get("m1")).toMatchObject({ awarded: 10 });
    // 10 * 0.4 = 4
    expect(resolved.get("m2")).toMatchObject({ awarded: 4 });
  });

  it("splits the closest tier evenly, rounded down, on a tie", () => {
    const answers = new Map<string, Answer>([
      ["m1", { value: 690 }], // distance 10, tied closest
      ["m2", { value: 710 }], // distance 10, tied closest
      ["m3", { value: 600 }], // distance 100
    ]);
    const resolved = numericResolver.resolveGroup!(question, answers, settled);

    // closest tier: floor(10 / 2) = 5 each.
    // second tier is m3 alone at distance 100: floor(10*0.5 / 1) = 5.
    expect(resolved.get("m1")).toMatchObject({ awarded: 5, status: "correct" });
    expect(resolved.get("m2")).toMatchObject({ awarded: 5, status: "correct" });
    expect(resolved.get("m3")).toMatchObject({ awarded: 5, status: "partial" });
  });

  it("splits the second tier evenly, rounded down, on a tie", () => {
    const answers = new Map<string, Answer>([
      ["m1", { value: 700 }], // distance 0 -> closest, full 10
      ["m2", { value: 685 }], // distance 15, tied second
      ["m3", { value: 715 }], // distance 15, tied second
    ]);
    const resolved = numericResolver.resolveGroup!(question, answers, settled);

    expect(resolved.get("m1")).toMatchObject({ awarded: 10, status: "correct" });
    // second-place pool is 5, split 2 ways -> floor(5/2) = 2 each
    expect(resolved.get("m2")).toMatchObject({ awarded: 2, status: "partial" });
    expect(resolved.get("m3")).toMatchObject({ awarded: 2, status: "partial" });
  });

  it("awards nothing beyond the closest tier when everyone ties for closest", () => {
    const answers = new Map<string, Answer>([
      ["m1", { value: 700 }],
      ["m2", { value: 700 }],
    ]);
    const resolved = numericResolver.resolveGroup!(question, answers, settled);

    expect(resolved.get("m1")).toMatchObject({ awarded: 5, status: "correct" });
    expect(resolved.get("m2")).toMatchObject({ awarded: 5, status: "correct" });
  });

  it("scores a member with no numeric answer as no_pick", () => {
    const answers = new Map<string, Answer>([
      ["m1", { value: 700 }],
      ["m2", {}],
    ]);
    const resolved = numericResolver.resolveGroup!(question, answers, settled);

    expect(resolved.get("m2")).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending for every answer when the question hasn't been settled yet", () => {
    const answers = new Map<string, Answer>([
      ["m1", { value: 700 }],
      ["m2", { value: 690 }],
    ]);
    const resolved = numericResolver.resolveGroup!(question, answers, {});

    expect(resolved.get("m1")).toMatchObject({ awarded: 0, status: "pending" });
    expect(resolved.get("m2")).toMatchObject({ awarded: 0, status: "pending" });
  });
});

describe("numericResolver.resolve", () => {
  // doc 03 §2.3's ranking only makes sense against competing answers;
  // resolve() delegates to the same core logic with a single-entry map, so a
  // lone answer is trivially "closest" once the question is settled.
  it("scores a lone answer as closest by construction, once settled", () => {
    const resolved = numericResolver.resolve(question, { value: 640 }, settled);
    expect(resolved).toMatchObject({ awarded: 10, status: "correct" });
  });

  it("scores zero with status no_pick when there is no answer", () => {
    const resolved = numericResolver.resolve(question, {}, settled);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending when the question hasn't been settled yet", () => {
    const resolved = numericResolver.resolve(question, { value: 640 }, {});
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });
});

// doc 03 §2.4: "For numeric, boldness does not apply (there's no meaningful
// 'share')." — proven by the resolver omitting the boldness extension points
// entirely, which is what keeps the orchestrator from ever computing a
// multiplier for it.
describe("numericResolver boldness exclusion", () => {
  it("does not implement boldnessUnits or correctUnitSet", () => {
    expect(numericResolver.boldnessUnits).toBeUndefined();
    expect(numericResolver.correctUnitSet).toBeUndefined();
  });
});
