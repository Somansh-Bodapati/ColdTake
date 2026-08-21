import { describe, expect, it } from "vitest";
import type { Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { booleanResolver } from "@/lib/scoring/resolvers/boolean";

const question: Question = {
  id: "q9",
  type: "boolean",
  config: {},
  points: 5,
};

const tournament: Tournament = {
  id: "ipl-2027",
  teamIds: ["mi", "rr"],
};

describe("booleanResolver.validate", () => {
  it("accepts a boolean answer", () => {
    expect(booleanResolver.validate({ bool: true }, question, tournament).ok).toBe(true);
    expect(booleanResolver.validate({ bool: false }, question, tournament).ok).toBe(true);
  });

  it("rejects a missing bool", () => {
    expect(booleanResolver.validate({}, question, tournament).ok).toBe(false);
  });

  it("rejects a non-boolean bool", () => {
    expect(booleanResolver.validate({ bool: "yes" }, question, tournament).ok).toBe(false);
  });

  it("rejects a non-object answer", () => {
    expect(booleanResolver.validate(true, question, tournament).ok).toBe(false);
  });
});

describe("booleanResolver.resolve", () => {
  it("awards full points on a match", () => {
    const results: ResultSet = { questionResults: { [question.id]: { bool: true } } };
    const resolved = booleanResolver.resolve(question, { bool: true }, results);
    expect(resolved).toEqual({ awarded: 5, status: "correct", explanation: expect.any(String) });
  });

  it("awards zero on a mismatch", () => {
    const results: ResultSet = { questionResults: { [question.id]: { bool: true } } };
    const resolved = booleanResolver.resolve(question, { bool: false }, results);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  it("scores zero with status no_pick when there is no answer", () => {
    const results: ResultSet = { questionResults: { [question.id]: { bool: true } } };
    const resolved = booleanResolver.resolve(question, {}, results);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending when the question hasn't been settled yet", () => {
    const resolved = booleanResolver.resolve(question, { bool: true }, {});
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });

  it("only reads the settled result for this question's id, not any other question's", () => {
    const results: ResultSet = { questionResults: { "other-question": { bool: true } } };
    const resolved = booleanResolver.resolve(question, { bool: true }, results);
    expect(resolved.status).toBe("pending");
  });
});

describe("booleanResolver boldness helpers", () => {
  it("boldnessUnits reflects the picked side", () => {
    expect(booleanResolver.boldnessUnits?.({ bool: true })).toEqual(["yes"]);
    expect(booleanResolver.boldnessUnits?.({ bool: false })).toEqual(["no"]);
  });

  it("boldnessUnits returns an empty array when there is no pick", () => {
    expect(booleanResolver.boldnessUnits?.({})).toEqual([]);
  });

  it("correctUnitSet returns the settled side", () => {
    const results: ResultSet = { questionResults: { [question.id]: { bool: false } } };
    expect(booleanResolver.correctUnitSet?.(question, results)).toEqual(new Set(["no"]));
  });

  it("correctUnitSet is empty when not yet settled", () => {
    expect(booleanResolver.correctUnitSet?.(question, {})).toEqual(new Set());
  });
});
