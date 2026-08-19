import { describe, expect, it } from "vitest";
import type { Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { teamOverUnderResolver } from "@/lib/scoring/resolvers/team-over-under";

// "Will CSK finish 4th or better?" -> comparison "under" (position < threshold).
const underQuestion: Question = {
  id: "q7",
  type: "team_over_under",
  config: { teamId: "csk", threshold: 4, comparison: "under" },
  points: 5,
};

const overQuestion: Question = {
  ...underQuestion,
  id: "q8",
  config: { teamId: "csk", threshold: 4, comparison: "over" },
};

const tournament: Tournament = {
  id: "ipl-2027",
  teamIds: ["mi", "rr", "csk", "gt"],
};

const cskThird: ResultSet = {
  finalTable: [
    { teamId: "mi", position: 1 },
    { teamId: "rr", position: 2 },
    { teamId: "csk", position: 3 },
    { teamId: "gt", position: 4 },
  ],
};

const cskLast: ResultSet = {
  finalTable: [
    { teamId: "mi", position: 1 },
    { teamId: "rr", position: 2 },
    { teamId: "gt", position: 3 },
    { teamId: "csk", position: 4 },
  ],
};

describe("teamOverUnderResolver.validate", () => {
  it("accepts a boolean answer with valid config", () => {
    const result = teamOverUnderResolver.validate({ bool: true }, underQuestion, tournament);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-boolean answer", () => {
    const result = teamOverUnderResolver.validate({}, underQuestion, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a config with a team not in the tournament", () => {
    const badQuestion: Question = {
      ...underQuestion,
      config: { teamId: "not-a-team", threshold: 4, comparison: "under" },
    };
    const result = teamOverUnderResolver.validate({ bool: true }, badQuestion, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a config with an invalid comparison", () => {
    const badQuestion: Question = {
      ...underQuestion,
      config: { teamId: "csk", threshold: 4, comparison: "sideways" },
    };
    const result = teamOverUnderResolver.validate({ bool: true }, badQuestion, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a config with a missing threshold", () => {
    const badQuestion: Question = { ...underQuestion, config: { teamId: "csk", comparison: "under" } };
    const result = teamOverUnderResolver.validate({ bool: true }, badQuestion, tournament);
    expect(result.ok).toBe(false);
  });
});

describe("teamOverUnderResolver.resolve", () => {
  it("scores 'under' correct when the team finishes better than the threshold", () => {
    // csk finished 3rd, threshold 4, "under" means position < 4 -> true.
    const resolved = teamOverUnderResolver.resolve(underQuestion, { bool: true }, cskThird);
    expect(resolved.awarded).toBe(5);
    expect(resolved.status).toBe("correct");
  });

  it("scores 'under' incorrect when the team finishes at or worse than the threshold", () => {
    const resolved = teamOverUnderResolver.resolve(underQuestion, { bool: true }, cskLast);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  it("scores 'over' correct when the team finishes worse than the threshold", () => {
    // csk finished 4th, threshold 4, "over" means position > 4 -> false, so
    // picking bool:false ("no, they won't finish worse than 4th") is wrong;
    // picking bool:true would also be wrong here since 4 is not > 4.
    const resolved = teamOverUnderResolver.resolve(overQuestion, { bool: false }, cskLast);
    expect(resolved.awarded).toBe(5);
    expect(resolved.status).toBe("correct");
  });

  it("agreeing with a false proposition scores incorrect", () => {
    const resolved = teamOverUnderResolver.resolve(overQuestion, { bool: true }, cskLast);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  it("scores zero with status no_pick when there is no answer", () => {
    const resolved = teamOverUnderResolver.resolve(underQuestion, {}, cskThird);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending when the final table isn't available yet", () => {
    const resolved = teamOverUnderResolver.resolve(underQuestion, { bool: true }, {});
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });

  it("returns pending when the configured team is missing from the final table", () => {
    const resolved = teamOverUnderResolver.resolve(underQuestion, { bool: true }, {
      finalTable: [{ teamId: "mi", position: 1 }],
    });
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });
});

describe("teamOverUnderResolver boldness helpers", () => {
  it("boldnessUnits reflects the side the member picked", () => {
    expect(teamOverUnderResolver.boldnessUnits?.({ bool: true })).toEqual(["yes"]);
    expect(teamOverUnderResolver.boldnessUnits?.({ bool: false })).toEqual(["no"]);
  });

  it("boldnessUnits returns an empty array when there is no pick", () => {
    expect(teamOverUnderResolver.boldnessUnits?.({})).toEqual([]);
  });

  it("correctUnitSet returns the winning side once settled", () => {
    expect(teamOverUnderResolver.correctUnitSet?.(underQuestion, cskThird)).toEqual(
      new Set(["yes"])
    );
    expect(teamOverUnderResolver.correctUnitSet?.(underQuestion, cskLast)).toEqual(
      new Set(["no"])
    );
  });

  it("correctUnitSet is empty when not yet settled", () => {
    expect(teamOverUnderResolver.correctUnitSet?.(underQuestion, {})).toEqual(new Set());
  });
});
