import { describe, expect, it } from "vitest";
import { buildStandingsCardElement } from "@/lib/cards/standings-card";
import type { StandingsCardData } from "@/lib/cards/types";
import { flattenText } from "@/lib/cards/test-support";

const baseData: StandingsCardData = {
  groupName: "The Cool Group",
  seasonName: "IPL 2027",
  isProjected: true,
  computedAt: "2027-04-01T12:00:00.000Z",
  standings: [
    { rank: 1, displayName: "Somansh", points: 42, delta: 3 },
    { rank: 2, displayName: "Rahul", points: 39, delta: -1 },
    { rank: 3, displayName: "Priya", points: 30, delta: 0 },
  ],
};

describe("buildStandingsCardElement", () => {
  it("includes the group name but not a join link (product removed the join link from cards)", () => {
    const text = flattenText(buildStandingsCardElement(baseData));
    expect(text).toContain(baseData.groupName);
    expect(text).not.toContain("/join?code=");
  });

  it("renders every row's rank, name, and points", () => {
    const text = flattenText(buildStandingsCardElement(baseData));
    for (const row of baseData.standings) {
      expect(text).toContain(`#${row.rank}`);
      expect(text).toContain(row.displayName);
      expect(text).toContain(`${row.points} pts`);
    }
  });

  it("labels projected standings unambiguously (doc 03 §2.5)", () => {
    expect(flattenText(buildStandingsCardElement(baseData))).toContain("PROJECTED");
    expect(
      flattenText(buildStandingsCardElement({ ...baseData, isProjected: false }))
    ).not.toContain("PROJECTED");
  });

  it("truncates beyond the card's row limit rather than overflowing", () => {
    const many: StandingsCardData = {
      ...baseData,
      standings: Array.from({ length: 12 }, (_, i) => ({
        rank: i + 1,
        displayName: `Member ${i}`,
        points: 100 - i,
        delta: 0,
      })),
    };
    const text = flattenText(buildStandingsCardElement(many));
    expect(text).toContain("#8");
    expect(text).not.toContain("#9");
  });
});
