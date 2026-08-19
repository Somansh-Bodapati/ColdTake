// Recap card (docs/01-PRD.md §6.1: "final standings and the season's best
// and worst calls"). Pure function of RecapCardData (src/lib/cards/types.ts)
// — assembled from the settled season's final standings_snapshot in
// src/lib/cards/assemble.ts.

import { cardFooter, cardFrame, el, COLORS, type CardElement } from "@/lib/cards/element";
import type { RecapCardCall, RecapCardData } from "@/lib/cards/types";

const MAX_ROWS = 3;

function standingsRow(row: RecapCardData["finalStandings"][number]): CardElement {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      padding: "8px 0",
      borderBottom: `1px solid ${COLORS.border}`,
      fontSize: "28px",
    },
    [
      el("div", { display: "flex", width: "60px", color: COLORS.muted, fontWeight: 700 }, `#${row.rank}`),
      el("div", { display: "flex", flexGrow: 1, fontWeight: 700 }, row.displayName),
      el("div", { display: "flex", color: COLORS.accent }, `${row.points} pts`),
    ]
  );
}

function callBlock(label: string, color: string, call: RecapCardCall | undefined): CardElement {
  return el(
    "div",
    { display: "flex", flexDirection: "column", flexGrow: 1 },
    [
      el("div", { display: "flex", fontSize: "18px", color, fontWeight: 700 }, label),
      call
        ? el(
            "div",
            { display: "flex", flexDirection: "column", marginTop: "4px" },
            [
              el("div", { display: "flex", fontSize: "22px", fontWeight: 700 }, call.displayName),
              el(
                "div",
                { display: "flex", fontSize: "18px", color: COLORS.muted },
                `${call.questionPrompt} — ${call.points}/${call.maxPossible}`
              ),
            ]
          )
        : el("div", { display: "flex", fontSize: "18px", color: COLORS.muted, marginTop: "4px" }, "—"),
    ]
  );
}

export function buildRecapCardElement(data: RecapCardData): CardElement {
  const shown = data.finalStandings.slice(0, MAX_ROWS);

  return cardFrame([
    el("div", { display: "flex", fontSize: "22px", color: COLORS.muted }, data.seasonName),
    el("div", { display: "flex", fontSize: "44px", fontWeight: 700, marginBottom: "16px" }, "Season recap"),
    el(
      "div",
      { display: "flex", flexDirection: "column" },
      shown.length > 0
        ? shown.map(standingsRow)
        : [el("div", { display: "flex", fontSize: "24px", color: COLORS.muted }, "No final standings.")]
    ),
    el(
      "div",
      { display: "flex", flexDirection: "row", marginTop: "24px", gap: "40px" },
      [
        callBlock("BEST CALL", COLORS.positive, data.bestCall),
        callBlock("WORST CALL", COLORS.negative, data.worstCall),
      ]
    ),
    cardFooter(data.groupName, data.joinUrl),
  ]);
}
