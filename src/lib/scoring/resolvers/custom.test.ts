import { describe, expect, it } from "vitest";
import type { Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { customResolver } from "@/lib/scoring/resolvers/custom";

const question: Question = {
  id: "q10",
  type: "custom",
  config: {
    options: [
      { id: "opt-a", label: "Option A" },
      { id: "opt-b", label: "Option B" },
    ],
  },
  points: 10,
};

const tournament: Tournament = {
  id: "ipl-2027",
  teamIds: ["mi", "rr"],
};

describe("customResolver.validate", () => {
  it("accepts an optionId from config.options", () => {
    expect(customResolver.validate({ optionId: "opt-a" }, question, tournament).ok).toBe(true);
  });

  it("rejects an optionId not in config.options", () => {
    expect(customResolver.validate({ optionId: "opt-c" }, question, tournament).ok).toBe(false);
  });

  it("rejects a missing optionId", () => {
    expect(customResolver.validate({}, question, tournament).ok).toBe(false);
  });

  it("rejects a question with no config.options", () => {
    const badQuestion: Question = { ...question, config: {} };
    expect(customResolver.validate({ optionId: "opt-a" }, badQuestion, tournament).ok).toBe(false);
  });
});

describe("customResolver.resolve", () => {
  it("awards full points on a match against the admin-settled option", () => {
    const results: ResultSet = { questionResults: { [question.id]: { optionId: "opt-a" } } };
    const resolved = customResolver.resolve(question, { optionId: "opt-a" }, results);
    expect(resolved).toEqual({ awarded: 10, status: "correct", explanation: expect.any(String) });
  });

  it("awards zero on a mismatch", () => {
    const results: ResultSet = { questionResults: { [question.id]: { optionId: "opt-a" } } };
    const resolved = customResolver.resolve(question, { optionId: "opt-b" }, results);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  it("scores zero with status no_pick when there is no answer", () => {
    const results: ResultSet = { questionResults: { [question.id]: { optionId: "opt-a" } } };
    const resolved = customResolver.resolve(question, {}, results);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending when the question hasn't been settled yet", () => {
    const resolved = customResolver.resolve(question, { optionId: "opt-a" }, {});
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });
});

describe("customResolver boldness helpers", () => {
  it("boldnessUnits returns the picked option", () => {
    expect(customResolver.boldnessUnits?.({ optionId: "opt-a" })).toEqual(["opt-a"]);
  });

  it("boldnessUnits returns an empty array when there is no pick", () => {
    expect(customResolver.boldnessUnits?.({})).toEqual([]);
  });

  it("correctUnitSet returns the settled option", () => {
    const results: ResultSet = { questionResults: { [question.id]: { optionId: "opt-b" } } };
    expect(customResolver.correctUnitSet?.(question, results)).toEqual(new Set(["opt-b"]));
  });

  it("correctUnitSet is empty when not yet settled", () => {
    expect(customResolver.correctUnitSet?.(question, {})).toEqual(new Set());
  });
});
