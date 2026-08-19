import { describe, expect, it } from "vitest";
import type { Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { championResolver } from "@/lib/scoring/resolvers/champion";

const question: Question = {
  id: "q1",
  type: "champion",
  config: {},
  points: 25,
};

const tournament: Tournament = {
  id: "ipl-2027",
  teamIds: ["mi", "rr", "csk"],
};

describe("championResolver.validate", () => {
  it("accepts a teamId that belongs to the tournament", () => {
    const result = championResolver.validate({ teamId: "mi" }, question, tournament);
    expect(result.ok).toBe(true);
  });

  it("rejects a missing teamId", () => {
    const result = championResolver.validate({}, question, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a team not in the tournament", () => {
    const result = championResolver.validate({ teamId: "csk-b" }, question, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object answer", () => {
    const result = championResolver.validate("mi", question, tournament);
    expect(result.ok).toBe(false);
  });
});

describe("championResolver.resolve", () => {
  it("awards full points on an exact match", () => {
    const results: ResultSet = { finalResult: { championTeamId: "rr" } };
    const resolved = championResolver.resolve(question, { teamId: "rr" }, results);
    expect(resolved).toEqual({
      awarded: 25,
      status: "correct",
      explanation: expect.stringContaining("25 of 25"),
    });
  });

  it("awards zero on a wrong pick", () => {
    const results: ResultSet = { finalResult: { championTeamId: "rr" } };
    const resolved = championResolver.resolve(question, { teamId: "mi" }, results);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
    expect(resolved.explanation).toContain("0 of 25");
  });

  // doc 01 §4.3: "Member submits an incomplete slate — unanswered questions
  // score zero; no penalty beyond that."
  it("scores zero with status no_pick when the answer has no teamId", () => {
    const results: ResultSet = { finalResult: { championTeamId: "rr" } };
    const resolved = championResolver.resolve(question, {}, results);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  // Projected mode / not-yet-settled: the champion isn't known yet.
  it("returns pending when the final result isn't available", () => {
    const results: ResultSet = {};
    const resolved = championResolver.resolve(question, { teamId: "mi" }, results);
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });
});

describe("championResolver boldness helpers", () => {
  it("boldnessUnits returns the single picked team", () => {
    expect(championResolver.boldnessUnits?.({ teamId: "mi" })).toEqual(["mi"]);
  });

  it("boldnessUnits returns an empty array when there is no pick", () => {
    expect(championResolver.boldnessUnits?.({})).toEqual([]);
  });

  it("correctUnitSet returns the champion team once settled", () => {
    const results: ResultSet = { finalResult: { championTeamId: "rr" } };
    expect(championResolver.correctUnitSet?.(question, results)).toEqual(new Set(["rr"]));
  });

  it("correctUnitSet is empty when not yet settled", () => {
    expect(championResolver.correctUnitSet?.(question, {})).toEqual(new Set());
  });
});
