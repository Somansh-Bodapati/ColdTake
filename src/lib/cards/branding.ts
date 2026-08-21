// Join-link construction shared by every card assembler and the invite/join
// pages — same `APP_URL` fallback api/auth/claim.ts already established for
// magic links, and the same `/join?code=` path api/groups/index.ts already
// hands back as `inviteUrl` (this session just gives that a real
// destination page, task 6).

// Trailing slash on the env var must not produce a double slash when
// concatenated below — see src/lib/http.ts's appUrl() for the same fix
// applied to Google OAuth's redirect_uri.
export function resolveAppUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

export function buildJoinUrl(joinCode: string): string {
  return `${resolveAppUrl()}/join?code=${encodeURIComponent(joinCode)}`;
}
