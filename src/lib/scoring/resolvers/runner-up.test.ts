import { describe, expect, it } from "vitest";
import type { Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { runnerUpResolver } from "@/lib/scoring/resolvers/runner-up";

const question: Question = {
  id: "q2",
  type: "runner_up",
  config: {},
  points: 15,
};

const tournament: Tournament = {
  id: "ipl-2027",
  teamIds: ["mi", "rr", "csk"],
};

describe("runnerUpResolver.validate", () => {
  it("accepts a teamId that belongs to the tournament", () => {
    const result = runnerUpResolver.validate({ teamId: "mi" }, question, tournament);
    expect(result.ok).toBe(true);
  });

  it("rejects a missing teamId", () => {
    const result = runnerUpResolver.validate({}, question, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a team not in the tournament", () => {
    const result = runnerUpResolver.validate({ teamId: "csk-b" }, question, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object answer", () => {
    const result = runnerUpResolver.validate("mi", question, tournament);
    expect(result.ok).toBe(false);
  });
});

describe("runnerUpResolver.resolve", () => {
  it("awards full points on an exact match", () => {
    const results: ResultSet = { finalResult: { runnerUpTeamId: "csk" } };
    const resolved = runnerUpResolver.resolve(question, { teamId: "csk" }, results);
    expect(resolved).toEqual({
      awarded: 15,
      status: "correct",
      explanation: expect.stringContaining("15 of 15"),
    });
  });

  it("awards zero on a wrong pick", () => {
    const results: ResultSet = { finalResult: { runnerUpTeamId: "csk" } };
    const resolved = runnerUpResolver.resolve(question, { teamId: "mi" }, results);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  // doc 01 §4.3: incomplete slate scores zero, no penalty.
  it("scores zero with status no_pick when the answer has no teamId", () => {
    const results: ResultSet = { finalResult: { runnerUpTeamId: "csk" } };
    const resolved = runnerUpResolver.resolve(question, {}, results);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending when the final result isn't available", () => {
    const results: ResultSet = {};
    const resolved = runnerUpResolver.resolve(question, { teamId: "mi" }, results);
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });
});

describe("runnerUpResolver boldness helpers", () => {
  it("boldnessUnits returns the single picked team", () => {
    expect(runnerUpResolver.boldnessUnits?.({ teamId: "mi" })).toEqual(["mi"]);
  });

  it("boldnessUnits returns an empty array when there is no pick", () => {
    expect(runnerUpResolver.boldnessUnits?.({})).toEqual([]);
  });

  it("correctUnitSet returns the runner-up team once settled", () => {
    const results: ResultSet = { finalResult: { runnerUpTeamId: "csk" } };
    expect(runnerUpResolver.correctUnitSet?.(question, results)).toEqual(new Set(["csk"]));
  });

  it("correctUnitSet is empty when not yet settled", () => {
    expect(runnerUpResolver.correctUnitSet?.(question, {})).toEqual(new Set());
  });
});
