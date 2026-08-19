import { describe, expect, it } from "vitest";
import { applyBoldness, boldnessMultiplier, computeShare } from "@/lib/scoring/boldness";

describe("boldnessMultiplier", () => {
  it("is 1.0 when everyone picked the same answer (share = 1)", () => {
    expect(boldnessMultiplier(1, 1)).toBe(1);
  });

  it("matches the doc's worked example: 1 of 8 -> 1.875", () => {
    // doc 01 §4.2: "if 1 of 8 did, multiplier is 1.875"
    expect(boldnessMultiplier(1 / 8, 1)).toBeCloseTo(1.875);
  });

  it("scales with a non-default weight", () => {
    expect(boldnessMultiplier(0, 0.5)).toBe(1.5);
  });
});

describe("computeShare", () => {
  it("returns the fraction of the population that picked the unit", () => {
    const unitsByMember = new Map([
      ["m1", ["mi"]],
      ["m2", ["mi"]],
      ["m3", ["rr"]],
    ]);
    expect(computeShare("mi", unitsByMember)).toBeCloseTo(2 / 3);
  });

  it("returns 0 for an empty population rather than dividing by zero", () => {
    expect(computeShare("mi", new Map())).toBe(0);
  });
});

describe("applyBoldness", () => {
  it("leaves awarded unchanged when there are no correct units", () => {
    const result = applyBoldness(0, [], () => 0, 1);
    expect(result).toEqual({ awarded: 0, multiplier: 1 });
  });

  it("applies the full-answer formula for a single-unit question (champion)", () => {
    // 1 of 8 picked it: boldness = 7/8, multiplier = 1.875, 25 * 1.875 = 46.875 -> 46
    const result = applyBoldness(25, ["rr"], () => 1 / 8, 1);
    expect(result.awarded).toBe(46);
    expect(result.multiplier).toBeCloseTo(1.875);
  });

  it("returns multiplier 1 with no boldness when everyone agreed", () => {
    const result = applyBoldness(25, ["rr"], () => 1, 1);
    expect(result.awarded).toBe(25);
    expect(result.multiplier).toBe(1);
  });

  // doc 03 §2.4: "for top_n_*, compute boldness per team within the answer"
  it("decomposes multi-unit awards per unit and floors only the total", () => {
    // baseAwarded 10 across 2 correct teams -> 5 each.
    // team A share 1 (multiplier 1) -> 5
    // team B share 1/4 (multiplier 1.75) -> 8.75
    // total 13.75 -> floors to 13
    const shareForUnit = (unit: string) => (unit === "a" ? 1 : 1 / 4);
    const result = applyBoldness(10, ["a", "b"], shareForUnit, 1);
    expect(result.awarded).toBe(13);
    expect(result.multiplier).toBeCloseTo(1.375);
  });

  it("never applies a multiplier when baseAwarded is zero", () => {
    const result = applyBoldness(0, ["a"], () => 0, 1);
    expect(result).toEqual({ awarded: 0, multiplier: 1 });
  });
});
