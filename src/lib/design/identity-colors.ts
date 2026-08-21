// Deterministic accent-colour system (Session 14 design brief: "team
// identity matters emotionally — accommodate per-team accent colours
// without letting them fight the interface").
//
// One hashed palette serves two jobs in this codebase: colouring a team's
// initials in the pick sheet's team-answer questions, and colouring a
// member's initials in the leaderboard. Both are "identity" badges over a
// free-text label (a typed team ID, or a member's display name) — no team
// catalogue or crest is fetched or stored anywhere (doc 05's "IPL franchise
// crests are trademarked... use team initials, colour blocks, or abstract
// marks"), so this is pure, derived, presentation-only colour, never joined
// against real branding.
//
// The palette deliberately excludes the primary gold/amber (`--primary` in
// src/app.css) so an identity swatch never gets mistaken for the "this is
// the CTA / this is you" accent used elsewhere in the interface.

export interface IdentityColor {
  readonly background: string;
  readonly foreground: string;
}

const PALETTE: readonly IdentityColor[] = [
  { background: "#E24C4B", foreground: "#FFFBF3" }, // crimson
  { background: "#3E6FD9", foreground: "#FFFBF3" }, // cobalt
  { background: "#1FA98D", foreground: "#FFFBF3" }, // teal
  { background: "#7C5CFC", foreground: "#FFFBF3" }, // violet
  { background: "#F2724D", foreground: "#241205" }, // coral
  { background: "#3E8E4F", foreground: "#FFFBF3" }, // forest
  { background: "#C4368C", foreground: "#FFFBF3" }, // magenta
  { background: "#2D9BD8", foreground: "#FFFBF3" }, // sky
  { background: "#D8A61E", foreground: "#241205" }, // mustard
  { background: "#5C6BC0", foreground: "#FFFBF3" }, // indigo
];

// A small, stable string hash (djb2) — deterministic across server and
// client so the same team ID or display name always lands on the same
// swatch, with no shared state or lookup table to keep in sync.
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
}

export function identityColorFor(seed: string): IdentityColor {
  const trimmed = seed.trim();
  if (trimmed.length === 0) {
    return { background: "var(--muted)", foreground: "var(--muted-foreground)" };
  }
  const index = hashString(trimmed.toUpperCase()) % PALETTE.length;
  return PALETTE[index];
}

// Real IPL franchise brand colors (this session's brief: "rcb will be red,
// kkr is purple, csk is yellow, mi is blue..."), layered on top of the
// hash-based fallback above rather than replacing it — a team whose name
// doesn't match one of the 10 current IPL franchises (a group running a
// non-IPL tournament, or a custom/renamed team) still falls through to
// `identityColorFor`'s hash palette untouched. Keyed by the exact lowercased
// team-name strings CricketData actually returns (verified against
// src/lib/providers/cricketdata-admin.ts's own `KNOWN_ABBREVIATIONS` table,
// e.g. "royal challengers bengaluru", not "RCB") so a lookup by real team
// name always hits.
//
// Unlike the hash palette, each franchise gets independent light/dark
// values: several of these are genuinely bright brand colors (CSK yellow,
// SRH orange) that read fine against the dark "floodlit scoreboard" surface
// but wash out against the light parchment surface, and the darkest navy
// brands (Delhi, Gujarat) need lifting a shade in dark mode so they don't
// blend into the app's own dark-navy background.
//
// Lucknow Super Giants judgment call: the product owner's own words tonight
// were "lsg is brown", but LSG's real branding is teal/turquoise and orange
// — there is no brown in it. Went with the product owner's literal, explicit
// instruction (brown) rather than silently overriding it with what's
// "actually" correct, since color choice here is a subjective design call,
// not a correctness bug, and they said it in so many words. Flagging this
// explicitly in case they actually meant "LSG's real color" and mis-recalled
// it as brown — easy to swap to teal (#0B7C76-ish) if so.
export interface ThemedIdentityColor {
  readonly light: IdentityColor;
  readonly dark: IdentityColor;
}

const IPL_FRANCHISE_COLORS: Readonly<Record<string, ThemedIdentityColor>> = {
  "mumbai indians": {
    light: { background: "#1755A6", foreground: "#FFFBF3" },
    dark: { background: "#3B74C9", foreground: "#FFFBF3" },
  },
  "chennai super kings": {
    light: { background: "#D99A12", foreground: "#241205" },
    dark: { background: "#FDB913", foreground: "#241205" },
  },
  "royal challengers bengaluru": {
    light: { background: "#7A1220", foreground: "#FFFBF3" },
    dark: { background: "#9C1B27", foreground: "#FFFBF3" },
  },
  "royal challengers bangalore": {
    light: { background: "#7A1220", foreground: "#FFFBF3" },
    dark: { background: "#9C1B27", foreground: "#FFFBF3" },
  },
  "kolkata knight riders": {
    light: { background: "#3A225D", foreground: "#FFFBF3" },
    dark: { background: "#5B3A8C", foreground: "#FFFBF3" },
  },
  "delhi capitals": {
    // Deliberately a shade darker/blacker than Mumbai's blue so the two
    // stay clearly distinguishable side by side, per the product owner's
    // explicit "distinguish clearly from Mumbai's blue" ask.
    light: { background: "#101E45", foreground: "#FFFBF3" },
    dark: { background: "#223668", foreground: "#FFFBF3" },
  },
  "punjab kings": {
    // A brighter, more orange-leaning red than RCB's deep crimson/maroon —
    // the product owner asked for "a different, distinguishable red."
    light: { background: "#C81E27", foreground: "#FFFBF3" },
    dark: { background: "#E8424B", foreground: "#241205" },
  },
  "rajasthan royals": {
    light: { background: "#C21F72", foreground: "#FFFBF3" },
    dark: { background: "#E8449C", foreground: "#241205" },
  },
  "sunrisers hyderabad": {
    light: { background: "#C24A16", foreground: "#FFFBF3" },
    dark: { background: "#FF7A33", foreground: "#241205" },
  },
  "gujarat titans": {
    // GT's real branding is navy blue + gold; a solid gold badge would be
    // too close to CSK's yellow and to this app's own gold accent
    // (--primary in src/app.css), so this uses their navy, tilted slightly
    // toward indigo/violet so it doesn't collide with Delhi Capitals' navy.
    light: { background: "#2E2B7A", foreground: "#FFFBF3" },
    dark: { background: "#4A46B0", foreground: "#FFFBF3" },
  },
  "lucknow super giants": {
    light: { background: "#6B4226", foreground: "#FFFBF3" },
    dark: { background: "#9C6B42", foreground: "#241205" },
  },
};

export function franchiseColorFor(teamName: string): ThemedIdentityColor | undefined {
  return IPL_FRANCHISE_COLORS[teamName.trim().toLowerCase()];
}

// Up to two letters to stand in for a crest — first letters of up to two
// words, or the first two characters of a single token (a raw team ID like
// "CSK" collapses sensibly to "CS").
export function initialsFor(seed: string): string {
  const trimmed = seed.trim();
  if (trimmed.length === 0) return "?";
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
