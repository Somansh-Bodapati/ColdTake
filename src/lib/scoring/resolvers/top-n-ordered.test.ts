import { describe, expect, it } from "vitest";
import type { Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { topNOrderedResolver } from "@/lib/scoring/resolvers/top-n-ordered";

const question: Question = {
  id: "q4",
  type: "top_n_ordered",
  config: { n: 4, exactBonus: 10 }, // doc 01 §4.1: 5 per correct team + 10 bonus
  points: 20,
};

const tournament: Tournament = {
  id: "ipl-2027",
  teamIds: ["mi", "rr", "csk", "gt", "rcb", "kkr"],
};

const finalTable: ResultSet = {
  finalTable: [
    { teamId: "mi", position: 1 },
    { teamId: "rr", position: 2 },
    { teamId: "csk", position: 3 },
    { teamId: "gt", position: 4 },
    { teamId: "rcb", position: 5 },
    { teamId: "kkr", position: 6 },
  ],
};

describe("topNOrderedResolver.validate", () => {
  it("accepts exactly n distinct teams from the pool", () => {
    const result = topNOrderedResolver.validate(
      { teamIds: ["mi", "rr", "csk", "gt"] },
      question,
      tournament
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a pick with the wrong number of teams", () => {
    const result = topNOrderedResolver.validate(
      { teamIds: ["mi", "rr", "csk"] },
      question,
      tournament
    );
    expect(result.ok).toBe(false);
  });

  // doc 01 §4.3: "Duplicate answers within a Top-N pick — Rejected at input validation."
  it("rejects duplicate teams", () => {
    const result = topNOrderedResolver.validate(
      { teamIds: ["mi", "mi", "csk", "gt"] },
      question,
      tournament
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a team outside the tournament's pool", () => {
    const result = topNOrderedResolver.validate(
      { teamIds: ["mi", "rr", "csk", "not-a-team"] },
      question,
      tournament
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a missing config.n", () => {
    const badQuestion: Question = { ...question, config: {} };
    const result = topNOrderedResolver.validate(
      { teamIds: ["mi", "rr", "csk", "gt"] },
      badQuestion,
      tournament
    );
    expect(result.ok).toBe(false);
  });
});

describe("topNOrderedResolver.resolve", () => {
  it("awards full points plus the exact bonus when every position matches", () => {
    const resolved = topNOrderedResolver.resolve(
      question,
      { teamIds: ["mi", "rr", "csk", "gt"] },
      finalTable
    );
    // 20 * 4/4 = 20, + 10 exact bonus = 30
    expect(resolved).toEqual({
      awarded: 30,
      status: "correct",
      explanation: expect.stringContaining("4 of 4"),
    });
  });

  // doc 03 §2.3: "points × (correctPositions / n), plus config.exactBonus if all positions match"
  it("awards partial credit by position, rounded down, with no bonus", () => {
    // position 1 (mi) and position 3 (csk) correct = 2 of 4. 20*2/4=10, no bonus.
    const resolved = topNOrderedResolver.resolve(
      question,
      { teamIds: ["mi", "gt", "csk", "rr"] },
      finalTable
    );
    expect(resolved.awarded).toBe(10);
    expect(resolved.status).toBe("partial");
  });

  it("scores a right team in the wrong position as incorrect for that slot", () => {
    // all four teams are in the picked set but every position is shifted by one.
    const resolved = topNOrderedResolver.resolve(
      question,
      { teamIds: ["rr", "csk", "gt", "mi"] },
      finalTable
    );
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  it("rounds partial credit down rather than to nearest", () => {
    const threeQuestion: Question = { ...question, config: { n: 3, exactBonus: 10 }, points: 10 };
    // only position 1 (mi) correct: 10 * 1/3 = 3.33 -> floors to 3
    const resolved = topNOrderedResolver.resolve(
      threeQuestion,
      { teamIds: ["mi", "gt", "kkr"] },
      finalTable
    );
    expect(resolved.awarded).toBe(3);
    expect(resolved.status).toBe("partial");
  });

  it("treats a missing exactBonus as zero", () => {
    const noBonusQuestion: Question = { ...question, config: { n: 4 } };
    const resolved = topNOrderedResolver.resolve(
      noBonusQuestion,
      { teamIds: ["mi", "rr", "csk", "gt"] },
      finalTable
    );
    expect(resolved.awarded).toBe(20);
    expect(resolved.status).toBe("correct");
  });

  // doc 01 §4.3: incomplete slate scores zero, no penalty.
  it("scores zero with status no_pick when there is no answer", () => {
    const resolved = topNOrderedResolver.resolve(question, {}, finalTable);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending when the final table isn't available yet", () => {
    const resolved = topNOrderedResolver.resolve(
      question,
      { teamIds: ["mi", "rr", "csk", "gt"] },
      {}
    );
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });
});

// doc 03 §2.4: "for top_n_*, compute boldness per team within the answer" —
// top_n_ordered reuses the exact same per-team mechanism as top_n_unordered
// (membership in the top-n set, not exact position).
describe("topNOrderedResolver boldness helpers", () => {
  it("boldnessUnits returns every picked team regardless of position", () => {
    expect(
      topNOrderedResolver.boldnessUnits?.({ teamIds: ["mi", "rr", "csk", "gt"] })
    ).toEqual(["mi", "rr", "csk", "gt"]);
  });

  it("correctUnitSet returns the top-n teams from the final table", () => {
    expect(topNOrderedResolver.correctUnitSet?.(question, finalTable)).toEqual(
      new Set(["mi", "rr", "csk", "gt"])
    );
  });

  it("correctUnitSet is empty when the final table isn't available yet", () => {
    expect(topNOrderedResolver.correctUnitSet?.(question, {})).toEqual(new Set());
  });
});
