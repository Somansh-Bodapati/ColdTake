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

// Shared palette (Session 14 design system) — a deep navy-ink surface with a
// warm scoreboard-gold accent, matching src/app.css's dark tokens rather
// than a generic slate/sky pairing. No gambling-adjacent imagery: this is a
// scoreboard, not a betting slip (CLAUDE.md rule 5 is about vocabulary, but
// the same restraint applies to visuals).
export const COLORS = {
  background: "#161f33", // matches --background (dark)
  surface: "#1f2a42", // matches --card (dark)
  border: "#33405c",
  text: "#f7f2e4", // warm ivory, matches --foreground (dark)
  muted: "#93a0b8", // matches --muted-foreground (dark)
  accent: "#e2a53f", // matches --primary (dark) — scoreboard gold
  positive: "#5fd97a",
  negative: "#f2545b",
} as const;

// Every card's outer frame: fixed size, flex column, dark background — the
// one piece of layout genuinely shared across all four card types. A thin
// top rule in the accent gold reads as "scoreboard bezel" even at thumbnail
// size in a WhatsApp chat, without needing an image asset.
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
      borderTop: `10px solid ${COLORS.accent}`,
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
