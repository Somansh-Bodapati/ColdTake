// Standings card (docs/01-PRD.md §6.1: "current leaderboard, weekly").
// Pure function of StandingsCardData (src/lib/cards/types.ts) — assembled
// from a single standings_snapshot row by src/lib/cards/assemble.ts.

import { cardFooter, cardFrame, el, COLORS, type CardElement } from "@/lib/cards/element";
import type { StandingsCardData } from "@/lib/cards/types";

const MAX_ROWS = 8;

function deltaLabel(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return String(delta);
  return "—";
}

function deltaColor(delta: number): string {
  if (delta > 0) return COLORS.positive;
  if (delta < 0) return COLORS.negative;
  return COLORS.muted;
}

function standingsRow(row: StandingsCardData["standings"][number]): CardElement {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      padding: "8px 0",
      borderBottom: `1px solid ${COLORS.border}`,
      fontSize: "26px",
    },
    [
      el("div", { display: "flex", width: "60px", color: COLORS.muted, fontWeight: 700 }, `#${row.rank}`),
      el("div", { display: "flex", flexGrow: 1, fontWeight: 700 }, row.displayName),
      el("div", { display: "flex", width: "110px", color: deltaColor(row.delta) }, deltaLabel(row.delta)),
      el(
        "div",
        { display: "flex", width: "140px", justifyContent: "flex-end", color: COLORS.accent },
        `${row.points} pts`
      ),
    ]
  );
}

export function buildStandingsCardElement(data: StandingsCardData): CardElement {
  const shown = data.standings.slice(0, MAX_ROWS);

  return cardFrame([
    el("div", { display: "flex", fontSize: "22px", color: COLORS.muted }, data.seasonName),
    el(
      "div",
      { display: "flex", flexDirection: "row", alignItems: "center", marginBottom: "20px" },
      [
        el("div", { display: "flex", fontSize: "44px", fontWeight: 700 }, "Standings"),
        ...(data.isProjected
          ? [
              el(
                "div",
                {
                  display: "flex",
                  marginLeft: "16px",
                  fontSize: "20px",
                  color: COLORS.muted,
                  border: `2px solid ${COLORS.border}`,
                  borderRadius: "6px",
                  padding: "4px 10px",
                },
                "PROJECTED"
              ),
            ]
          : []),
      ]
    ),
    el(
      "div",
      { display: "flex", flexDirection: "column", flexGrow: 1 },
      shown.length > 0
        ? shown.map(standingsRow)
        : [el("div", { display: "flex", fontSize: "24px", color: COLORS.muted }, "No standings yet.")]
    ),
    cardFooter(data.groupName, data.joinUrl),
  ]);
}
