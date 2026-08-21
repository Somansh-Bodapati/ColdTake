// Zod schemas for the auth API boundary (doc 03 §3.1), shared by client
// (fetch calls, forms) and server (api/auth/*) so both sides parse the
// exact same shape.

import { z } from "zod";

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required")
  .max(60, "Display name must be 60 characters or fewer");

export const anonymousSignupRequestSchema = z.object({
  displayName: displayNameSchema,
});
export type AnonymousSignupRequest = z.infer<typeof anonymousSignupRequestSchema>;

export const anonymousSignupResponseSchema = z.object({
  userId: z.string(),
  sessionToken: z.string(),
});
export type AnonymousSignupResponse = z.infer<typeof anonymousSignupResponseSchema>;

export const claimRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});
export type ClaimRequest = z.infer<typeof claimRequestSchema>;

// No email provider is wired up yet (docs/DECISIONS.md) — the claim
// magic-link token/URL is returned directly in the response body instead of
// being emailed. TODO(session: email provider chosen): stop returning
// claimUrl/token here once an email provider sends it instead.
export const claimResponseSchema = z.object({
  claimUrl: z.string(),
  token: z.string(),
  expiresAt: z.string(),
});
export type ClaimResponse = z.infer<typeof claimResponseSchema>;

export const verifyRequestSchema = z.object({
  token: z.string().min(1, "Token is required"),
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export const verifyResponseSchema = z.object({
  userId: z.string(),
  sessionToken: z.string(),
});
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;

// GET /api/auth/google/callback?code=...&state=... — Google redirects back
// with either `code`+`state` (consent granted) or an `error` (the user
// declined, or something else went wrong on Google's side).
export const googleCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});
export type GoogleCallbackQuery = z.infer<typeof googleCallbackQuerySchema>;

export const confirmNameRequestSchema = z.object({
  displayName: displayNameSchema,
});
export type ConfirmNameRequest = z.infer<typeof confirmNameRequestSchema>;

export const meUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  avatarSeed: z.string(),
  claimedAt: z.string().nullable(),
  // True only for a brand-new Google sign-in that hasn't completed the
  // one-time name prompt yet (src/lib/auth/google.ts's needsNamePrompt).
  // Anonymous/claimed users are always false — they chose their name
  // up front.
  needsNamePrompt: z.boolean().default(false),
});
export type MeUser = z.infer<typeof meUserSchema>;

export const meGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(["admin", "member"]),
});
export type MeGroup = z.infer<typeof meGroupSchema>;

export const meResponseSchema = z.object({
  user: meUserSchema,
  groups: z.array(meGroupSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
