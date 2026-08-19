import { describe, expect, it } from "vitest";
import { generateJoinCode, JOIN_CODE_CHARSET, JOIN_CODE_PATTERN } from "./join-code";

describe("generateJoinCode", () => {
  it("produces a 6-character code from the restricted charset", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateJoinCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(JOIN_CODE_PATTERN);
      for (const char of code) {
        expect(JOIN_CODE_CHARSET).toContain(char);
      }
    }
  });

  it("excludes the ambiguous glyphs O, 0, I, and 1", () => {
    expect(JOIN_CODE_CHARSET).not.toContain("O");
    expect(JOIN_CODE_CHARSET).not.toContain("0");
    expect(JOIN_CODE_CHARSET).not.toContain("I");
    expect(JOIN_CODE_CHARSET).not.toContain("1");
  });

  it("has a 32-character charset (power of two, so byte % length is unbiased)", () => {
    expect(JOIN_CODE_CHARSET).toHaveLength(32);
    expect(new Set(JOIN_CODE_CHARSET).size).toBe(32);
  });
});
