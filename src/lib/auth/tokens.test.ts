import { describe, expect, it } from "vitest";
import { generateRawToken, hashToken, hashesEqual } from "@/lib/auth/tokens";

describe("generateRawToken", () => {
  it("returns a base64url string with no padding", () => {
    const token = generateRawToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("=");
  });

  it("returns a different value on every call (256 bits of entropy)", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateRawToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("hashToken", () => {
  it("is deterministic", () => {
    const raw = generateRawToken();
    expect(hashToken(raw)).toBe(hashToken(raw));
  });

  it("produces a 64-char lowercase hex sha256 digest", () => {
    expect(hashToken("anything")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different inputs", () => {
    expect(hashToken(generateRawToken())).not.toBe(hashToken(generateRawToken()));
  });

  it("never returns the raw input", () => {
    const raw = "super-secret-token";
    expect(hashToken(raw)).not.toBe(raw);
    expect(hashToken(raw)).not.toContain(raw);
  });
});

describe("hashesEqual", () => {
  it("is true for two identical hashes", () => {
    const hash = hashToken("same-input");
    expect(hashesEqual(hash, hashToken("same-input"))).toBe(true);
  });

  it("is false for two different hashes", () => {
    expect(hashesEqual(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("is false (not throwing) when lengths differ", () => {
    expect(hashesEqual("ab", "abcd")).toBe(false);
  });
});
