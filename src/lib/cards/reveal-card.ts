// Reveal card (docs/01-PRD.md §6.1: "everyone's champion pick, at lock").
// Pure function of already-resolved data (src/lib/cards/types.ts's
// RevealCardData) — src/lib/cards/assemble.ts is what turns DB rows into
// this shape; this file only ever builds a Satori element tree from it, so
// it's testable with plain fixtures (reveal-card.test.ts), no DB required.

import { cardFooter, cardFrame, el, COLORS, type CardElement } from "./element.js";
import type { RevealCardData } from "./types.js";

// Rows beyond this still fit on the 630px-tall card at a readable size;
// past it the list would overflow, so the card caption says how many more
// there are instead of shrinking text past legibility.
const MAX_ROWS = 6;

function pickRow(pick: RevealCardData["picks"][number]): CardElement {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "10px 0",
      borderBottom: `1px solid ${COLORS.border}`,
      fontSize: "26px",
    },
    [
      el("div", { display: "flex", fontWeight: 700 }, pick.displayName),
      el("div", { display: "flex", color: COLORS.accent }, pick.answerLabel),
    ]
  );
}

export function buildRevealCardElement(data: RevealCardData): CardElement {
  const shown = data.picks.slice(0, MAX_ROWS);
  const overflow = data.picks.length - shown.length;

  return cardFrame([
    el("div", { display: "flex", fontSize: "22px", color: COLORS.muted }, data.seasonName),
    el(
      "div",
      { display: "flex", fontSize: "44px", fontWeight: 700, marginBottom: "8px" },
      "The picks are in"
    ),
    el(
      "div",
      { display: "flex", fontSize: "24px", color: COLORS.muted, marginBottom: "20px" },
      data.highlightPrompt
    ),
    el(
      "div",
      { display: "flex", flexDirection: "column", flexGrow: 1 },
      shown.length > 0
        ? [
            ...shown.map(pickRow),
            ...(overflow > 0
              ? [
                  el(
                    "div",
                    { display: "flex", fontSize: "20px", color: COLORS.muted, paddingTop: "10px" },
                    `+${overflow} more`
                  ),
                ]
              : []),
          ]
        : [el("div", { display: "flex", fontSize: "24px", color: COLORS.muted }, "No picks yet.")]
    ),
    cardFooter(data.groupName, data.joinUrl),
  ]);
}
