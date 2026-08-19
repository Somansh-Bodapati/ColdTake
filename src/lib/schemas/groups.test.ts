// Pins joinCodeSchema's pattern (duplicated as a literal, see the comment
// in groups.ts explaining why) against the real generator in
// src/lib/groups/join-code.ts, so the two can't silently drift apart.

import { describe, expect, it } from "vitest";
import { generateJoinCode } from "@/lib/groups/join-code";
import { joinCodeSchema } from "./groups";

describe("joinCodeSchema", () => {
  it("accepts every code generateJoinCode can produce", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(joinCodeSchema.safeParse(generateJoinCode()).success).toBe(true);
    }
  });

  it("rejects the excluded glyphs even at the right length", () => {
    expect(joinCodeSchema.safeParse("ABCD0O").success).toBe(false);
    expect(joinCodeSchema.safeParse("ABCD1I").success).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(joinCodeSchema.safeParse("ABCDE").success).toBe(false);
    expect(joinCodeSchema.safeParse("ABCDEFG").success).toBe(false);
  });
});
