import type { CSSProperties } from "react";
import { franchiseColorFor, identityColorFor, initialsFor } from "@/lib/design/identity-colors";
import { cn } from "@/lib/utils";

interface IdentityBadgeProps {
  seed: string;
  // Real team name (e.g. "Chennai Super Kings"), separate from `seed` (which
  // is typically the shorter badge label, e.g. "CSK") — this session's brief
  // adds real IPL brand colors, and unlike the hash palette they vary by
  // light/dark theme (see src/lib/design/identity-colors.ts), so the actual
  // theme swap happens in CSS (below) rather than JS re-render.
  teamName?: string;
  size?: "sm" | "md" | "lg";
  shape?: "circle" | "square";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<IdentityBadgeProps["size"]>, string> = {
  sm: "size-6 text-[10px]",
  md: "size-9 text-xs",
  lg: "size-12 text-base",
};

// Abstract initials-in-a-swatch badge (Session 14 design brief) — stands in
// for a team crest or a member avatar without reproducing any real
// trademark (unless `teamName` matches a real IPL franchise, in which case
// this session's brief calls for its actual brand color). `seed` is
// whatever free-text identity string is already in hand (a typed team ID, a
// display name); initials are always derived from it. Colour prefers a real
// franchise match on `teamName` and otherwise falls back to the same hashed
// palette as before — the two light/dark variants are handed to CSS as
// custom properties, and `.identity-badge`'s dark-mode override in
// src/app.css picks between them, so a theme change never needs a re-render.
export function IdentityBadge({ seed, teamName, size = "md", shape = "circle", className }: IdentityBadgeProps) {
  const franchise = teamName ? franchiseColorFor(teamName) : undefined;
  const fallback = identityColorFor(seed);
  const light = franchise?.light ?? fallback;
  const dark = franchise?.dark ?? fallback;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "identity-badge font-score inline-flex shrink-0 items-center justify-center",
        shape === "circle" ? "rounded-full" : "rounded-md",
        SIZE_CLASS[size],
        className
      )}
      style={
        {
          "--identity-bg-light": light.background,
          "--identity-fg-light": light.foreground,
          "--identity-bg-dark": dark.background,
          "--identity-fg-dark": dark.foreground,
        } as CSSProperties
      }
    >
      {initialsFor(seed)}
    </span>
  );
}
