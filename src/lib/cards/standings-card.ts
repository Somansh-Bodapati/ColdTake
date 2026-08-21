// Standings card (docs/01-PRD.md §6.1: "current leaderboard, weekly").
// Pure function of StandingsCardData (src/lib/cards/types.ts) — assembled
// from a single standings_snapshot row by src/lib/cards/assemble.ts.

import { cardFooter, cardFrame, el, COLORS, type CardElement } from "./element.js";
import type { StandingsCardData } from "./types.js";

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

// Rank 1 gets the gold treatment (surface tint + accent-coloured number) so
// the "who's winning" answer reads instantly at thumbnail size in a WhatsApp
// chat — the whole reason this card exists (doc 05: "the share card is the
// hero").
function standingsRow(row: StandingsCardData["standings"][number]): CardElement {
  const isLeader = row.rank === 1;
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      padding: "12px 16px",
      marginBottom: "6px",
      borderRadius: "10px",
      backgroundColor: isLeader ? "#2a2311" : COLORS.surface,
      border: isLeader ? `1px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
      fontSize: "26px",
    },
    [
      el(
        "div",
        {
          display: "flex",
          width: "64px",
          fontWeight: 800,
          color: isLeader ? COLORS.accent : COLORS.muted,
        },
        `#${row.rank}`
      ),
      el("div", { display: "flex", flexGrow: 1, fontWeight: 700 }, row.displayName),
      el(
        "div",
        { display: "flex", width: "110px", fontWeight: 700, color: deltaColor(row.delta) },
        deltaLabel(row.delta)
      ),
      el(
        "div",
        { display: "flex", width: "150px", justifyContent: "flex-end", fontWeight: 800, color: COLORS.text },
        `${row.points} pts`
      ),
    ]
  );
}

export function buildStandingsCardElement(data: StandingsCardData): CardElement {
  const shown = data.standings.slice(0, MAX_ROWS);

  return cardFrame([
    el("div", { display: "flex", fontSize: "22px", color: COLORS.muted, fontWeight: 700 }, data.seasonName),
    el(
      "div",
      { display: "flex", flexDirection: "row", alignItems: "center", marginBottom: "24px" },
      [
        el("div", { display: "flex", fontSize: "52px", fontWeight: 800, letterSpacing: "-1px" }, "Standings"),
        // Projected vs. final is a hard requirement (doc 03 §2.5) — solid
        // gold fill when settled, an outlined chip when still projected, so
        // the two states are never confusable even in a thumbnail.
        ...(data.isProjected
          ? [
              el(
                "div",
                {
                  display: "flex",
                  marginLeft: "18px",
                  fontSize: "20px",
                  fontWeight: 800,
                  color: COLORS.accent,
                  border: `2px solid ${COLORS.accent}`,
                  borderRadius: "999px",
                  padding: "6px 16px",
                },
                "PROJECTED"
              ),
            ]
          : [
              el(
                "div",
                {
                  display: "flex",
                  marginLeft: "18px",
                  fontSize: "20px",
                  fontWeight: 800,
                  color: COLORS.background,
                  backgroundColor: COLORS.positive,
                  borderRadius: "999px",
                  padding: "6px 16px",
                },
                "FINAL"
              ),
            ]),
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
