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
