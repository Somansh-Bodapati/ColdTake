// Shared plumbing for the four api/cards/* routes — pulling the
// `:timestamp.png` segment out of the URL, checking it against the card's
// actual canonical timestamp (this session's brief, task 4: "genuinely
// immutable"), and building the PNG response with the long-lived
// Cache-Control header. Mirrors src/lib/http.ts's role for the JSON API
// routes, just for this one binary-response shape.

import { pathSegment } from "@/lib/http";
import { AppError } from "@/lib/errors";

const PNG_SUFFIX = ".png";

// Every card URL ends `.../:timestamp.png` — Vercel's file-based routing
// (api/cards/*/[seasonId]/[timestamp].ts) hands the whole trailing segment,
// extension included, to the handler as one path parameter (there's no
// separate static-file extension match for a Function route), so the
// suffix is stripped here rather than relied on for routing.
export function readTimestampSegment(request: Request): string {
  const raw = pathSegment(request, 0);
  if (!raw.endsWith(PNG_SUFFIX)) {
    throw new AppError(404, "Card URLs must end in .png");
  }
  return decodeURIComponent(raw.slice(0, -PNG_SUFFIX.length));
}

// The whole point of the immutable URL scheme: a URL either names the
// card's one true canonical instant, or it 404s — it never silently
// re-renders "whatever the data looks like now" under a stale timestamp.
// Callers that want the *current* card fetch the JSON standings/season
// endpoint first (as the UI's share button does) to learn the current
// timestamp, then request that exact URL.
export function assertCanonicalTimestamp(requested: string, canonical: string): void {
  if (requested !== canonical) {
    throw new AppError(404, "This card URL is out of date — fetch the current one first");
  }
}

export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function pngResponse(png: Buffer): Response {
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": IMMUTABLE_CACHE_CONTROL,
    },
  });
}
