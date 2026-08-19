// Zod schemas for the groups API boundary (doc 03 §3.2), shared by client
// and server so both sides parse the exact same shape. Mirrors the style of
// src/lib/schemas/auth.ts.

import { z } from "zod";

// Kept as a literal here (not imported from src/lib/groups/join-code.ts)
// deliberately: that module also exports generateJoinCode(), which pulls in
// node:crypto — fine on the server, but this schema file is imported by
// client code too (src/lib/groups/client.ts), and Vite would bundle
// node:crypto into the browser build for a function the browser never
// calls. Charset/length must stay in sync with join-code.ts by hand;
// join-code.test.ts pins both.
const JOIN_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export const groupNameSchema = z
  .string()
  .trim()
  .min(1, "Group name is required")
  .max(80, "Group name must be 80 characters or fewer");

export const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(6, "Join code must be 6 characters")
  .regex(JOIN_CODE_PATTERN, "Join code must use only A-Z (excluding O/I) and 2-9 (excluding 0/1)");

export const groupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  joinCode: z.string(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const createGroupRequestSchema = z.object({
  name: groupNameSchema,
});
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

export const createGroupResponseSchema = z.object({
  group: groupSummarySchema,
  inviteUrl: z.string(),
});
export type CreateGroupResponse = z.infer<typeof createGroupResponseSchema>;

export const joinGroupRequestSchema = z.object({
  joinCode: joinCodeSchema,
});
export type JoinGroupRequest = z.infer<typeof joinGroupRequestSchema>;

export const joinGroupResponseSchema = z.object({
  group: groupSummarySchema,
});
export type JoinGroupResponse = z.infer<typeof joinGroupResponseSchema>;

export const groupMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string(),
  role: z.enum(["admin", "member"]),
  joinedAt: z.string(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

// Minimal per-season summary for the group page's season list (this
// hardening session's fix, see src/lib/seasons/service.ts's
// listSeasonsByGroup) — just enough to render a list with the right link
// per status, not the full SeasonResponse (questions/scoringConfig aren't
// needed here and would mean an extra join per season).
export const groupSeasonSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "open", "locked", "settled", "voided"]),
  lockAt: z.string(),
});
export type GroupSeasonSummary = z.infer<typeof groupSeasonSummarySchema>;

export const groupDetailResponseSchema = z.object({
  group: groupSummarySchema,
  members: z.array(groupMemberSchema),
  seasons: z.array(groupSeasonSummarySchema),
});
export type GroupDetailResponse = z.infer<typeof groupDetailResponseSchema>;

export const transferAdminRequestSchema = z.object({
  memberId: z.string().min(1, "memberId is required"),
});
export type TransferAdminRequest = z.infer<typeof transferAdminRequestSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;

// GET /api/groups/by-code/:code — the public join-preview lookup (this
// session's brief, task 6). Deliberately narrower than groupSummarySchema:
// a not-yet-a-member visitor gets just enough to render "You're invited to
// join {name}," never the join code itself (that's only in the URL they
// already have) or any member data.
export const groupPreviewResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type GroupPreviewResponse = z.infer<typeof groupPreviewResponseSchema>;
