// Pure unit tests for the lock-state derivation (CLAUDE.md rule 3 / doc 03
// §4). No DB, no clock — `now` is always passed in explicitly, which is the
// whole point: these must hold true "even if every scheduled job dies."

import { describe, expect, it } from "vitest";
import { canPublish, effectiveSeasonStatus, isMutableStatus, isTerminalStatus } from "./state";

const LOCK_AT = new Date("2026-03-20T14:00:00.000Z");
const BEFORE_LOCK = new Date("2026-03-20T13:59:59.000Z");
const AT_LOCK = new Date("2026-03-20T14:00:00.000Z");
const AFTER_LOCK = new Date("2026-03-20T14:00:01.000Z");

describe("effectiveSeasonStatus", () => {
  it("leaves an open season open before lock_at", () => {
    expect(effectiveSeasonStatus("open", LOCK_AT, BEFORE_LOCK)).toBe("open");
  });

  it("flips an open season to locked exactly at lock_at", () => {
    expect(effectiveSeasonStatus("open", LOCK_AT, AT_LOCK)).toBe("locked");
  });

  it("flips an open season to locked any time after lock_at", () => {
    expect(effectiveSeasonStatus("open", LOCK_AT, AFTER_LOCK)).toBe("locked");
  });

  it("never auto-opens a draft season, even long past lock_at", () => {
    // draft -> open is an explicit admin action (publish), not time-driven —
    // a season that was never published must not silently become pickable.
    expect(effectiveSeasonStatus("draft", LOCK_AT, AFTER_LOCK)).toBe("draft");
  });

  it("leaves an already-locked season locked regardless of the clock", () => {
    expect(effectiveSeasonStatus("locked", LOCK_AT, BEFORE_LOCK)).toBe("locked");
  });

  it("never derives settled or voided from time — those are explicit-only", () => {
    expect(effectiveSeasonStatus("settled", LOCK_AT, AFTER_LOCK)).toBe("settled");
    expect(effectiveSeasonStatus("voided", LOCK_AT, AFTER_LOCK)).toBe("voided");
  });
});

describe("isTerminalStatus", () => {
  it("is true only for settled and voided", () => {
    expect(isTerminalStatus("settled")).toBe(true);
    expect(isTerminalStatus("voided")).toBe(true);
    expect(isTerminalStatus("draft")).toBe(false);
    expect(isTerminalStatus("open")).toBe(false);
    expect(isTerminalStatus("locked")).toBe(false);
  });
});

describe("isMutableStatus", () => {
  it("is true only for draft and open", () => {
    expect(isMutableStatus("draft")).toBe(true);
    expect(isMutableStatus("open")).toBe(true);
    expect(isMutableStatus("locked")).toBe(false);
    expect(isMutableStatus("settled")).toBe(false);
    expect(isMutableStatus("voided")).toBe(false);
  });
});

describe("canPublish", () => {
  it("requires at least one question", () => {
    expect(canPublish({ questionCount: 0, lockAt: AFTER_LOCK, now: BEFORE_LOCK })).toBe(false);
    expect(canPublish({ questionCount: 1, lockAt: AFTER_LOCK, now: BEFORE_LOCK })).toBe(true);
  });

  it("requires lock_at to be strictly in the future", () => {
    expect(canPublish({ questionCount: 1, lockAt: BEFORE_LOCK, now: AFTER_LOCK })).toBe(false);
    expect(canPublish({ questionCount: 1, lockAt: AT_LOCK, now: AT_LOCK })).toBe(false);
  });
});
