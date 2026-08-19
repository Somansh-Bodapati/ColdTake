// Join-link construction shared by every card assembler and the invite/join
// pages — same `APP_URL` fallback api/auth/claim.ts already established for
// magic links, and the same `/join?code=` path api/groups/index.ts already
// hands back as `inviteUrl` (this session just gives that a real
// destination page, task 6).

export function resolveAppUrl(): string {
  return process.env.APP_URL ?? "http://localhost:5173";
}

export function buildJoinUrl(joinCode: string): string {
  return `${resolveAppUrl()}/join?code=${encodeURIComponent(joinCode)}`;
}
