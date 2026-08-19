// Pure join-code generation — no I/O, no DB (mirrors src/lib/auth/tokens.ts:
// crypto only, no new dependency).
//
// Charset: uppercase A-Z and digits 2-9, excluding O, 0, I, and 1 — the four
// glyphs people misread over voice/text/photo of a phone screen (O/0,
// I/1). 26 letters - {O, I} = 24, 10 digits - {0, 1} = 8, total 32 = 2^5.
// That power-of-two size means `randomByte % 32` has zero modulo bias, so a
// single random byte per character is both simple and uniform — no
// rejection sampling needed.
import { randomBytes } from "node:crypto";

export const JOIN_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;

// Matches JOIN_CODE_CHARSET exactly — used to validate user-entered codes at
// the Zod boundary (src/lib/schemas/groups.ts).
export const JOIN_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function generateJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    // Safe: `bytes` has length JOIN_CODE_LENGTH and i stays within bounds.
    code += JOIN_CODE_CHARSET[bytes[i]! % JOIN_CODE_CHARSET.length];
  }
  return code;
}
