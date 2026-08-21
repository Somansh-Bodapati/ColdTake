// Proves the data -> element mapping for the reveal card (this session's
// brief, task 9: "structurally-assert the Satori element tree... contains
// expected text like group name and join link"). No DB, no Satori render —
// buildRevealCardElement is a pure function of RevealCardData
// (src/lib/cards/types.ts), so a fixture object is enough.

import { describe, expect, it } from "vitest";
import { buildRevealCardElement } from "@/lib/cards/reveal-card";
import type { RevealCardData } from "@/lib/cards/types";
import { flattenText } from "@/lib/cards/test-support";

const baseData: RevealCardData = {
  groupName: "The Cool Group",
  joinUrl: "http://localhost:5173/join?code=ABC234",
  seasonName: "IPL 2027",
  highlightPrompt: "Who wins the title?",
  picks: [
    { displayName: "Somansh", answerLabel: "Chennai Super Kings" },
    { displayName: "Rahul", answerLabel: "Mumbai Indians" },
  ],
};

describe("buildRevealCardElement", () => {
  it("uses flexbox-only layout throughout the tree", () => {
    const tree = buildRevealCardElement(baseData);
    function assertFlexOnly(node: ReturnType<typeof buildRevealCardElement>): void {
      const display = node.props.style?.display;
      if (display !== undefined) {
        expect(display).not.toBe("grid");
      }
      const children = node.props.children;
      const list = Array.isArray(children) ? children : children ? [children] : [];
      for (const child of list) {
        if (typeof child !== "string") assertFlexOnly(child);
      }
    }
    assertFlexOnly(tree);
  });

  it("includes the group name and join link (task 5: every card carries branding)", () => {
    const text = flattenText(buildRevealCardElement(baseData));
    expect(text).toContain(baseData.groupName);
    expect(text).toContain(baseData.joinUrl);
  });

  it("includes the season name, highlight prompt, and every member's pick", () => {
    const text = flattenText(buildRevealCardElement(baseData));
    expect(text).toContain(baseData.seasonName);
    expect(text).toContain(baseData.highlightPrompt);
    for (const pick of baseData.picks) {
      expect(text).toContain(pick.displayName);
      expect(text).toContain(pick.answerLabel);
    }
  });

  it("shows an overflow count instead of silently dropping extra picks", () => {
    const manyPicks: RevealCardData = {
      ...baseData,
      picks: Array.from({ length: 9 }, (_, i) => ({
        displayName: `Member ${i}`,
        answerLabel: "Some Team",
      })),
    };
    const text = flattenText(buildRevealCardElement(manyPicks));
    expect(text).toContain("+3 more");
  });

  it("renders a fallback message when nobody has picked yet", () => {
    const text = flattenText(buildRevealCardElement({ ...baseData, picks: [] }));
    expect(text).toContain("No picks yet.");
  });
});
