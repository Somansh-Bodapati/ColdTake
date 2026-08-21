import { describe, expect, it } from "vitest";
import type { Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { topNUnorderedResolver } from "@/lib/scoring/resolvers/top-n-unordered";

const question: Question = {
  id: "q3",
  type: "top_n_unordered",
  config: { n: 4 },
  points: 20, // 5 per correct team, doc 01 §4.1
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

describe("topNUnorderedResolver.validate", () => {
  it("accepts exactly n distinct teams from the pool", () => {
    const result = topNUnorderedResolver.validate(
      { teamIds: ["mi", "rr", "csk", "gt"] },
      question,
      tournament
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a pick with the wrong number of teams", () => {
    const result = topNUnorderedResolver.validate(
      { teamIds: ["mi", "rr", "csk"] },
      question,
      tournament
    );
    expect(result.ok).toBe(false);
  });

  // doc 01 §4.3: "Duplicate answers within a Top-N pick — Rejected at input validation."
  it("rejects duplicate teams", () => {
    const result = topNUnorderedResolver.validate(
      { teamIds: ["mi", "mi", "csk", "gt"] },
      question,
      tournament
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a team outside the tournament's pool", () => {
    const result = topNUnorderedResolver.validate(
      { teamIds: ["mi", "rr", "csk", "not-a-team"] },
      question,
      tournament
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a missing config.n", () => {
    const badQuestion: Question = { ...question, config: {} };
    const result = topNUnorderedResolver.validate(
      { teamIds: ["mi", "rr", "csk", "gt"] },
      badQuestion,
      tournament
    );
    expect(result.ok).toBe(false);
  });
});

describe("topNUnorderedResolver.resolve", () => {
  it("awards full points when all n picks are correct", () => {
    const resolved = topNUnorderedResolver.resolve(
      question,
      { teamIds: ["mi", "rr", "csk", "gt"] },
      finalTable
    );
    expect(resolved).toEqual({
      awarded: 20,
      status: "correct",
      explanation: expect.stringContaining("4 of 4"),
    });
  });

  // doc 03 §2.3: "points × (correctTeams / n), rounded down. Status partial if 0 < correct < n"
  it("awards partial credit, rounded down, for a partly-correct pick", () => {
    const resolved = topNUnorderedResolver.resolve(
      question,
      { teamIds: ["mi", "rr", "rcb", "kkr"] }, // 2 of 4 correct: 20 * 2/4 = 10
      finalTable
    );
    expect(resolved.awarded).toBe(10);
    expect(resolved.status).toBe("partial");
  });

  it("rounds partial credit down rather than to nearest", () => {
    const threeQuestion: Question = { ...question, config: { n: 3 }, points: 10 };
    // 1 of 3 correct: 10 * 1/3 = 3.33 -> floors to 3
    const resolved = topNUnorderedResolver.resolve(
      threeQuestion,
      { teamIds: ["mi", "rcb", "kkr"] },
      finalTable
    );
    expect(resolved.awarded).toBe(3);
    expect(resolved.status).toBe("partial");
  });

  it("awards zero and status incorrect when nothing matches", () => {
    const resolved = topNUnorderedResolver.resolve(
      question,
      { teamIds: ["rcb", "kkr", "not-a-team-1", "not-a-team-2"] },
      finalTable
    );
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  // doc 01 §4.3: incomplete slate scores zero, no penalty.
  it("scores zero with status no_pick when there is no answer", () => {
    const resolved = topNUnorderedResolver.resolve(question, {}, finalTable);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending when the final table isn't available yet", () => {
    const resolved = topNUnorderedResolver.resolve(
      question,
      { teamIds: ["mi", "rr", "csk", "gt"] },
      {}
    );
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });
});

describe("topNUnorderedResolver boldness helpers", () => {
  it("boldnessUnits returns every picked team", () => {
    expect(
      topNUnorderedResolver.boldnessUnits?.({ teamIds: ["mi", "rr", "csk", "gt"] })
    ).toEqual(["mi", "rr", "csk", "gt"]);
  });

  it("correctUnitSet returns the top-n teams from the final table", () => {
    expect(topNUnorderedResolver.correctUnitSet?.(question, finalTable)).toEqual(
      new Set(["mi", "rr", "csk", "gt"])
    );
  });

  it("correctUnitSet is empty when the final table isn't available yet", () => {
    expect(topNUnorderedResolver.correctUnitSet?.(question, {})).toEqual(new Set());
  });
});
