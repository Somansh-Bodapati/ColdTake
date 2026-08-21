// Thin fetch wrappers around the groups API, parsed with the shared Zod
// schemas (src/lib/schemas/groups.ts) — same shape as the fetch calls in
// src/lib/session/provider.tsx, just for group endpoints instead of auth.
// Kept separate from the session context since groups aren't part of
// client-side session *state* (the group list is; individual group detail/
// admin actions are one-off requests a route component makes for itself).

import {
  createGroupRequestSchema,
  createGroupResponseSchema,
  joinGroupRequestSchema,
  joinGroupResponseSchema,
  groupDetailResponseSchema,
  groupPreviewResponseSchema,
  promoteAdminRequestSchema,
  type CreateGroupResponse,
  type JoinGroupResponse,
  type GroupDetailResponse,
  type GroupPreviewResponse,
} from "@/lib/schemas/groups";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body === "object" && body !== null && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return fallback;
}

export async function createGroupRequest(name: string): Promise<CreateGroupResponse> {
  const response = await fetch("/api/groups", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(createGroupRequestSchema.parse({ name })),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not create the group"));
  }
  return createGroupResponseSchema.parse(await response.json());
}

export async function joinGroupRequest(joinCode: string): Promise<JoinGroupResponse> {
  const response = await fetch("/api/groups/join", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(joinGroupRequestSchema.parse({ joinCode })),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not join the group"));
  }
  return joinGroupResponseSchema.parse(await response.json());
}

// Public (no credentials): the join-preview lookup the /join landing page
// uses before the visitor has a session at all.
export async function fetchGroupPreviewByCode(joinCode: string): Promise<GroupPreviewResponse> {
  const response = await fetch(`/api/groups/by-code/${encodeURIComponent(joinCode)}`);
  if (!response.ok) {
    throw new Error(await errorMessage(response, "That invite link doesn't look right"));
  }
  return groupPreviewResponseSchema.parse(await response.json());
}

export async function fetchGroupDetail(groupId: string): Promise<GroupDetailResponse> {
  const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not load the group"));
  }
  return groupDetailResponseSchema.parse(await response.json());
}

export async function removeGroupMember(groupId: string, memberId: string): Promise<void> {
  const response = await fetch(
    `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
    { method: "DELETE", credentials: "include" }
  );
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not remove that member"));
  }
}

// Promotes a member to admin without touching anyone else's role — any
// current admin can call this (multi-admin support, this session's fix).
export async function promoteGroupAdmin(groupId: string, memberId: string): Promise<void> {
  const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/admins`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(promoteAdminRequestSchema.parse({ memberId })),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not make that member an admin"));
  }
}

// Demotes an admin back to a plain member — the server refuses (400) if
// they're currently the group's only admin.
export async function demoteGroupAdmin(groupId: string, memberId: string): Promise<void> {
  const response = await fetch(
    `/api/groups/${encodeURIComponent(groupId)}/admins/${encodeURIComponent(memberId)}`,
    { method: "DELETE", credentials: "include" }
  );
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Could not remove that admin"));
  }
}
