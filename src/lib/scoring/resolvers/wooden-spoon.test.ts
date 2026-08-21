import { describe, expect, it } from "vitest";
import type { Question, ResultSet, Tournament } from "@/lib/scoring/types";
import { woodenSpoonResolver } from "@/lib/scoring/resolvers/wooden-spoon";

const question: Question = {
  id: "q5",
  type: "wooden_spoon",
  config: {},
  points: 10,
};

const tournament: Tournament = {
  id: "ipl-2027",
  teamIds: ["mi", "rr", "csk", "gt"],
};

const finalTable: ResultSet = {
  finalTable: [
    { teamId: "mi", position: 1 },
    { teamId: "rr", position: 2 },
    { teamId: "csk", position: 3 },
    { teamId: "gt", position: 4 },
  ],
};

describe("woodenSpoonResolver.validate", () => {
  it("accepts a teamId that belongs to the tournament", () => {
    const result = woodenSpoonResolver.validate({ teamId: "gt" }, question, tournament);
    expect(result.ok).toBe(true);
  });

  it("rejects a missing teamId", () => {
    const result = woodenSpoonResolver.validate({}, question, tournament);
    expect(result.ok).toBe(false);
  });

  it("rejects a team not in the tournament", () => {
    const result = woodenSpoonResolver.validate({ teamId: "not-a-team" }, question, tournament);
    expect(result.ok).toBe(false);
  });
});

describe("woodenSpoonResolver.resolve", () => {
  it("awards full points when the pick matches the last-placed team", () => {
    const resolved = woodenSpoonResolver.resolve(question, { teamId: "gt" }, finalTable);
    expect(resolved).toEqual({
      awarded: 10,
      status: "correct",
      explanation: expect.stringContaining("10 of 10"),
    });
  });

  it("awards zero on a wrong pick", () => {
    const resolved = woodenSpoonResolver.resolve(question, { teamId: "mi" }, finalTable);
    expect(resolved.awarded).toBe(0);
    expect(resolved.status).toBe("incorrect");
  });

  // doc 01 §4.3: incomplete slate scores zero, no penalty.
  it("scores zero with status no_pick when there is no answer", () => {
    const resolved = woodenSpoonResolver.resolve(question, {}, finalTable);
    expect(resolved).toEqual({
      awarded: 0,
      status: "no_pick",
      explanation: expect.any(String),
    });
  });

  it("returns pending when the final table isn't available yet", () => {
    const resolved = woodenSpoonResolver.resolve(question, { teamId: "gt" }, {});
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });

  it("returns pending when the final table is empty", () => {
    const resolved = woodenSpoonResolver.resolve(question, { teamId: "gt" }, { finalTable: [] });
    expect(resolved.status).toBe("pending");
    expect(resolved.awarded).toBe(0);
  });
});

describe("woodenSpoonResolver boldness helpers", () => {
  it("boldnessUnits returns the single picked team", () => {
    expect(woodenSpoonResolver.boldnessUnits?.({ teamId: "gt" })).toEqual(["gt"]);
  });

  it("correctUnitSet returns the last-placed team once settled", () => {
    expect(woodenSpoonResolver.correctUnitSet?.(question, finalTable)).toEqual(new Set(["gt"]));
  });

  it("correctUnitSet is empty when not yet settled", () => {
    expect(woodenSpoonResolver.correctUnitSet?.(question, {})).toEqual(new Set());
  });
});
