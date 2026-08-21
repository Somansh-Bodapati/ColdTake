// Proves isValidIngestSecret rejects a wrong/missing secret and accepts the
// right one, and — since actual timing can't be asserted in a unit test
// (this session's brief, task 4) — that it really goes through
// node:crypto's timingSafeEqual rather than a plain `===` comparison.
//
// ingest-auth.ts imports node:crypto as a default (CJS-shaped) object and
// calls `nodeCrypto.timingSafeEqual(...)` off it rather than destructuring a
// named import, specifically so this spy works: named ESM bindings off a
// Node builtin are frozen and can't be vi.spyOn'd, but the default-imported
// object is a plain mutable object whose property can be replaced.

import { describe, expect, it, vi } from "vitest";
import nodeCrypto from "node:crypto";
import { isValidIngestSecret, readBearerToken } from "@/lib/providers/ingest-auth";

describe("isValidIngestSecret", () => {
  it("accepts the exact expected secret", () => {
    expect(isValidIngestSecret("correct-secret", "correct-secret")).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(isValidIngestSecret("wrong-secret!", "correct-secret")).toBe(false);
  });

  it("rejects a wrong secret of a different length without throwing", () => {
    expect(isValidIngestSecret("short", "correct-secret")).toBe(false);
  });

  it("rejects a missing secret", () => {
    expect(isValidIngestSecret(null, "correct-secret")).toBe(false);
  });

  it("uses node:crypto's timingSafeEqual for the actual comparison, not ===", () => {
    const spy = vi.spyOn(nodeCrypto, "timingSafeEqual");
    isValidIngestSecret("correct-secret", "correct-secret");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("does not call timingSafeEqual when lengths already differ (would throw)", () => {
    const spy = vi.spyOn(nodeCrypto, "timingSafeEqual");
    isValidIngestSecret("short", "correct-secret");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("readBearerToken", () => {
  it("extracts the token from a well-formed Authorization header", () => {
    const request = new Request("http://localhost/api/ingest/x", {
      headers: { authorization: "Bearer abc123" },
    });
    expect(readBearerToken(request)).toBe("abc123");
  });

  it("returns null when the header is missing or malformed", () => {
    expect(readBearerToken(new Request("http://localhost/api/ingest/x"))).toBeNull();
    expect(
      readBearerToken(new Request("http://localhost/api/ingest/x", { headers: { authorization: "Basic xyz" } }))
    ).toBeNull();
  });
});
