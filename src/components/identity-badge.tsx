import { identityColorFor, initialsFor } from "@/lib/design/identity-colors";
import { cn } from "@/lib/utils";

interface IdentityBadgeProps {
  seed: string;
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
// trademark. `seed` is whatever free-text identity string is already in
// hand (a typed team ID, a display name); colour and initials are both
// derived from it, never fetched.
export function IdentityBadge({ seed, size = "md", shape = "circle", className }: IdentityBadgeProps) {
  const color = identityColorFor(seed);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "font-score inline-flex shrink-0 items-center justify-center",
        shape === "circle" ? "rounded-full" : "rounded-md",
        SIZE_CLASS[size],
        className
      )}
      style={{ backgroundColor: color.background, color: color.foreground }}
    >
      {initialsFor(seed)}
    </span>
  );
}
