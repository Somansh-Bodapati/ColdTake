import { randomUUID } from "node:crypto";

// A collision-resistant, URL-safe text ID for every "text primary key" column
// (doc 03 §1 calls for nanoid/cuid2). We don't have either as a dependency
// yet and adding one wasn't authorized for this session, so we derive an
// equivalent-strength id from crypto.randomUUID() instead: strip the
// hyphens, keep the 122 bits of randomness.
export function createId(): string {
  return randomUUID().replace(/-/g, "");
}
