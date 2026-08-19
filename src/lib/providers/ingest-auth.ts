// Constant-time comparison for INGEST_SECRET (this session's brief, task 4).
// A plain `providedSecret === expectedSecret` string comparison short-
// circuits on the first mismatched character, so its running time leaks how
// many leading characters an attacker has already guessed correctly —
// enough to brute-force the secret one character at a time against a
// network-latency oracle. node:crypto's timingSafeEqual compares two
// equal-length buffers in constant time instead, closing that channel.
// Imported as the default (CJS-style) export, not a named `{ timingSafeEqual }`
// import: that keeps the reference a plain mutable-object property lookup
// (`nodeCrypto.timingSafeEqual(...)`) rather than a synthesized, frozen ESM
// named binding — the latter can't be swapped for a spy in tests (this
// session's brief, task 4, wants a test that proves timingSafeEqual is what
// actually runs the comparison).
import nodeCrypto from "node:crypto";

export function isValidIngestSecret(providedSecret: string | null, expectedSecret: string): boolean {
  if (!providedSecret) {
    return false;
  }

  const providedBuffer = Buffer.from(providedSecret);
  const expectedBuffer = Buffer.from(expectedSecret);

  // timingSafeEqual throws (rather than returning false) when the buffers
  // differ in length, and a secret of the wrong length can never be valid
  // anyway, so this short-circuits first. Comparing lengths isn't itself
  // constant-time, but the threat this guards against — brute-forcing the
  // secret's *characters* — doesn't depend on hiding its length.
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return nodeCrypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length);
}
