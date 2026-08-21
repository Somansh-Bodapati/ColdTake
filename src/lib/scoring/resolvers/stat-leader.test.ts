import { describe, expect, it } from "vitest";
import type { Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { statLeaderResolver } from "@/lib/scoring/resolvers/stat-leader";

const question: Question = {
  id: "q6",
  type: "stat_leader",
  config: { statCategory: "runs" },
  points: 15,
};

const tournament: Tournament = {
  id: "ipl-2027",
  teamIds: ["mi", "rr", "csk"],
};

const results: ResultSet = {
  statLeaders: {
    runs: [
      { playerId: "p1", value: 640 },
      { playerId: "p2", value: 610 },
    ],
  },
};

const tiedResults: ResultSet = {
  statLeaders: {
    runs: [
      { playerId: "p1", value: 600 },
      { playerId: "p2", value: 600 },
      { playerId: "p3", value: 590 },
    ],
  },
};

describe("statLeaderResolver.validate", () => {
  it("accepts a playerId when config.statCategory is set", () => {
    const result = statLeaderResolver.validate({ playerId: "p1" }, question, tournament);
    expect(result.ok).toBe(true);
  });

  it("rejects a missing playerId", () => {
    const result = statLeaderResolver.validate({}, question, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a missing config.statCategory", () => {
    const badQuestion: Question = { ...question, config: {} };
    const result = statLeaderResolver.validate({ playerId: "p1" }, badQuestion, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object answer", () => {
    const result = statLeaderResolver.validate("p1", question, tournament);
    expect(result.ok).toBe(false);
  });
});

describe("statLeaderResolver.resolve", () => {
  it("awards full points for the sole leader", () => {
    const resolved = statLeaderResolver.resolve(question, { playerId: "p1" }, results);
    expect(resolved).toEqual({
      awarded: 15,
      status: "correct",
      explanation: expect.any(String),
    });
  });

  it("awards zero for a non-leader", () => {
    const resolved = statLeaderResolver.resolve(question, { playerId: "p2" }, results);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  // doc 01 §4.3: "Tie in a stat race ... otherwise both picks score full points."
  it("awards full points to every tied leader", () => {
    const p1 = statLeaderResolver.resolve(question, { playerId: "p1" }, tiedResults);
    const p2 = statLeaderResolver.resolve(question, { playerId: "p2" }, tiedResults);
    expect(p1.awarded).toBe(15);
    expect(p1.status).toBe("correct");
    expect(p2.awarded).toBe(15);
    expect(p2.status).toBe("correct");
  });

  it("awards zero to a player behind the tied leaders", () => {
    const resolved = statLeaderResolver.resolve(question, { playerId: "p3" }, tiedResults);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  // doc 01 §4.3: "Picked player doesn't play / is injured out — Pick scores
  // zero." A player absent from the leaderboard is simply not the leader.
  it("scores zero for a player who doesn't appear in the leaderboard at all", () => {
    const resolved = statLeaderResolver.resolve(question, { playerId: "injured-out" }, results);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  it("scores zero with status no_pick when there is no answer", () => {
    const resolved = statLeaderResolver.resolve(question, {}, results);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending when the stat category hasn't been reported yet", () => {
    const resolved = statLeaderResolver.resolve(question, { playerId: "p1" }, {});
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });

  it("returns pending when the question is misconfigured (missing config.statCategory)", () => {
    const badQuestion: Question = { ...question, config: {} };
    const resolved = statLeaderResolver.resolve(badQuestion, { playerId: "p1" }, results);
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });
});

describe("statLeaderResolver boldness helpers", () => {
  it("boldnessUnits returns the single picked player", () => {
    expect(statLeaderResolver.boldnessUnits?.({ playerId: "p1" })).toEqual(["p1"]);
  });

  it("correctUnitSet returns every tied leader", () => {
    expect(statLeaderResolver.correctUnitSet?.(question, tiedResults)).toEqual(
      new Set(["p1", "p2"])
    );
  });

  it("correctUnitSet is empty when not yet available", () => {
    expect(statLeaderResolver.correctUnitSet?.(question, {})).toEqual(new Set());
  });
});
