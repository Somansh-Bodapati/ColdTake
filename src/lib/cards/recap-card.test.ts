import { describe, expect, it } from "vitest";
import { buildRecapCardElement } from "@/lib/cards/recap-card";
import type { RecapCardData } from "@/lib/cards/types";
import { flattenText } from "@/lib/cards/test-support";

const baseData: RecapCardData = {
  groupName: "The Cool Group",
  joinUrl: "http://localhost:5173/join?code=ABC234",
  seasonName: "IPL 2027",
  finalStandings: [
    { rank: 1, displayName: "Somansh", points: 88 },
    { rank: 2, displayName: "Rahul", points: 75 },
  ],
  bestCall: { displayName: "Somansh", questionPrompt: "Who wins the title?", points: 30, maxPossible: 30 },
  worstCall: { displayName: "Rahul", questionPrompt: "Orange cap?", points: 0, maxPossible: 20 },
};

describe("buildRecapCardElement", () => {
  it("includes the group name and join link", () => {
    const text = flattenText(buildRecapCardElement(baseData));
    expect(text).toContain(baseData.groupName);
    expect(text).toContain(baseData.joinUrl);
  });

  it("renders final standings rows", () => {
    const text = flattenText(buildRecapCardElement(baseData));
    for (const row of baseData.finalStandings) {
      expect(text).toContain(`#${row.rank}`);
      expect(text).toContain(row.displayName);
      expect(text).toContain(`${row.points} pts`);
    }
  });

  it("renders the best and worst call with their question prompts and scores", () => {
    const text = flattenText(buildRecapCardElement(baseData));
    expect(text).toContain("BEST CALL");
    expect(text).toContain("WORST CALL");
    expect(text).toContain("Who wins the title?");
    expect(text).toContain("30/30");
    expect(text).toContain("Orange cap?");
    expect(text).toContain("0/20");
  });

  it("falls back gracefully when there is no best/worst call yet", () => {
    const text = flattenText(
      buildRecapCardElement({ ...baseData, bestCall: undefined, worstCall: undefined })
    );
    expect(text).toContain("BEST CALL");
    expect(text).toContain("WORST CALL");
  });
});
