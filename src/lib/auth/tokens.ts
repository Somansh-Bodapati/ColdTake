// Pure token generation/hashing helpers — no I/O, no DB. Uses node:crypto
// only (CLAUDE.md: no new dependency without asking; the built-in module
// covers this).
//
// Tokens are high-entropy random values (256 bits), so a plain salt-free
// SHA-256 digest is an appropriate "hash" here: the point isn't to defend
// against dictionary/brute-force guessing of a low-entropy secret (that's
// what scrypt/bcrypt are for), it's to avoid keeping the bearer token
// readable in the DB. A fixed digest also lets verification look the row up
// directly by tokenHash instead of scanning every row with a salted
// comparison.

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

// URL-safe, no padding — safe to embed directly in a magic-link URL.
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

// Constant-time equality for comparing two hex digests of equal expected
// length, so a mistaken caller that skips the DB lookup and compares tokens
// directly (e.g. INGEST_SECRET-style checks) doesn't leak timing info.
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
