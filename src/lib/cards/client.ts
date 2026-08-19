// Client-side card URL builder — turns an already-known immutable domain
// timestamp (a standings snapshot's `computedAt`, a season's `lockAt`) into
// the exact `/api/cards/:type/:seasonId/:timestamp.png` URL those routes
// serve (src/lib/cards/http.ts's readTimestampSegment/assertCanonicalTimestamp
// on the server side). The UI never mints its own timestamp — it always
// uses one it already has from a JSON response, so the URL it builds is
// guaranteed to match the card's canonical one.

export type CardKind = "reveal" | "standings" | "swing" | "recap";

export function buildCardUrl(kind: CardKind, seasonId: string, timestampIso: string): string {
  return `/api/cards/${kind}/${encodeURIComponent(seasonId)}/${encodeURIComponent(timestampIso)}.png`;
}
