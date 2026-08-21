import { describe, expect, it } from "vitest";
import { buildSwingCardElement } from "@/lib/cards/swing-card";
import type { SwingCardData } from "@/lib/cards/types";
import { flattenText } from "@/lib/cards/test-support";

const baseData: SwingCardData = {
  groupName: "The Cool Group",
  joinUrl: "http://localhost:5173/join?code=ABC234",
  seasonName: "IPL 2027",
  displayName: "Somansh",
  fromRank: 5,
  toRank: 1,
  fromPoints: 20,
  toPoints: 35,
  asOf: "2027-04-10T09:00:00.000Z",
};

describe("buildSwingCardElement", () => {
  it("includes the group name, join link, member name, and both ranks", () => {
    const text = flattenText(buildSwingCardElement(baseData));
    expect(text).toContain(baseData.groupName);
    expect(text).toContain(baseData.joinUrl);
    expect(text).toContain(baseData.displayName);
    expect(text).toContain("#5");
    expect(text).toContain("#1");
  });

  it("says 'jumped' when rank improves and 'dropped' when it worsens", () => {
    expect(flattenText(buildSwingCardElement(baseData))).toContain("jumped 4 places");
    expect(
      flattenText(buildSwingCardElement({ ...baseData, fromRank: 1, toRank: 5 }))
    ).toContain("dropped 4 places");
  });

  it("shows a signed points delta", () => {
    expect(flattenText(buildSwingCardElement(baseData))).toContain("+15 pts");
    expect(
      flattenText(buildSwingCardElement({ ...baseData, toPoints: 10 }))
    ).toContain("-10 pts");
  });
});
