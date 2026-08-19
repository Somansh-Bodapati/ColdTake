// Minimal JSX-free element builder for Satori (docs/02-TECH-STACK-OPTIONS.md
// §6: "Satori... Supports a CSS subset"). Satori's input is just a React-
// element-shaped object — `{ type, props: { style, children } }` — it never
// actually calls into React, so building that object by hand here avoids
// pulling a JSX pragma / tsx toolchain into the project for four static
// layouts. Every style object in this folder must stick to flexbox (no
// `display: grid`) — that's Satori's real constraint (this session's brief,
// task 3), not a style preference.

export interface CardElement {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: CardElement | CardElement[] | string | (CardElement | string)[];
    [key: string]: unknown;
  };
}

export function el(
  type: string,
  style: Record<string, string | number> = {},
  children?: CardElement["props"]["children"]
): CardElement {
  return {
    type,
    props: {
      style,
      ...(children === undefined ? {} : { children }),
    },
  };
}

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

// Shared palette — no gambling-adjacent imagery, just a clean dark card
// (CLAUDE.md rule 5 is about vocabulary, but the same restraint applies to
// visuals: this is a scoreboard, not a betting slip).
export const COLORS = {
  background: "#0f172a", // slate-900
  surface: "#1e293b", // slate-800
  border: "#334155", // slate-700
  text: "#f8fafc", // slate-50
  muted: "#94a3b8", // slate-400
  accent: "#38bdf8", // sky-400
  positive: "#4ade80", // green-400
  negative: "#f87171", // red-400
} as const;

// Every card's outer frame: fixed size, flex column, dark background — the
// one piece of layout genuinely shared across all four card types.
export function cardFrame(children: CardElement["props"]["children"]): CardElement {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: `${CARD_WIDTH}px`,
      height: `${CARD_HEIGHT}px`,
      backgroundColor: COLORS.background,
      color: COLORS.text,
      padding: "48px",
      fontFamily: "Inter",
    },
    children
  );
}

// Every card's footer (this session's brief, task 5): group name on the
// left, join link on the right, no external images — just text and a
// hairline rule drawn with flex + border, never `<img>`.
export function cardFooter(groupName: string, joinUrl: string): CardElement {
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      marginTop: "auto",
      paddingTop: "20px",
      borderTop: `2px solid ${COLORS.border}`,
    },
    [
      el(
        "div",
        {
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        [
          el(
            "div",
            { display: "flex", fontSize: "28px", fontWeight: 700, color: COLORS.text },
            groupName
          ),
          el(
            "div",
            { display: "flex", fontSize: "22px", color: COLORS.accent },
            joinUrl
          ),
        ]
      ),
    ]
  );
}
