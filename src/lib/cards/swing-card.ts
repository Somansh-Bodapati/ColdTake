// Swing card (docs/01-PRD.md §6.1: "'Somansh jumped 4 places' after a big
// result"). Pure function of SwingCardData (src/lib/cards/types.ts) —
// assembled by comparing a season's two most recent standings_snapshot rows
// in src/lib/cards/assemble.ts (Session 9's snapshot history).

import { cardFooter, cardFrame, el, COLORS, type CardElement } from "@/lib/cards/element";
import type { SwingCardData } from "@/lib/cards/types";

function directionWord(fromRank: number, toRank: number): string {
  return toRank < fromRank ? "jumped" : toRank > fromRank ? "dropped" : "held";
}

function directionColor(fromRank: number, toRank: number): string {
  return toRank < fromRank ? COLORS.positive : toRank > fromRank ? COLORS.negative : COLORS.muted;
}

export function buildSwingCardElement(data: SwingCardData): CardElement {
  const places = Math.abs(data.fromRank - data.toRank);
  const word = directionWord(data.fromRank, data.toRank);
  const pointsDelta = data.toPoints - data.fromPoints;

  return cardFrame([
    el("div", { display: "flex", fontSize: "22px", color: COLORS.muted }, data.seasonName),
    el(
      "div",
      { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" },
      [
        el("div", { display: "flex", fontSize: "48px", fontWeight: 700 }, data.displayName),
        el(
          "div",
          { display: "flex", fontSize: "40px", color: directionColor(data.fromRank, data.toRank), marginTop: "8px" },
          places === 0 ? "held position" : `${word} ${places} ${places === 1 ? "place" : "places"}`
        ),
        el(
          "div",
          { display: "flex", flexDirection: "row", marginTop: "28px", fontSize: "30px", alignItems: "center" },
          [
            el("div", { display: "flex", color: COLORS.muted }, `#${data.fromRank}`),
            el("div", { display: "flex", margin: "0 16px", color: COLORS.muted }, "→"),
            el("div", { display: "flex", fontWeight: 700 }, `#${data.toRank}`),
            el(
              "div",
              { display: "flex", marginLeft: "24px", color: COLORS.accent },
              `${pointsDelta >= 0 ? "+" : ""}${pointsDelta} pts`
            ),
          ]
        ),
      ]
    ),
    cardFooter(data.groupName, data.joinUrl),
  ]);
}
