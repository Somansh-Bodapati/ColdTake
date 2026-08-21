import * as React from "react";
import { Link } from "react-router";
import type { Route } from "./+types/home";
import { useSession } from "@/lib/session/use-session";
import { createGroupRequest, joinGroupRequest } from "@/lib/groups/client";
import { Button } from "@/components/ui/button";
import { IdentityBadge } from "@/components/identity-badge";

const fieldClass =
  "border-input bg-card rounded-lg border px-4 py-3 text-base shadow-xs placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "ColdTake" },
    { name: "description", content: "Season-long sports prediction game." },
  ];
}

// Minimal end-to-end exercise of the auth flow (Session 5 brief, task 5):
// name entry -> anonymous session -> optional email claim. No group/season
// UI yet — that's Milestone 2+.
export default function Home() {
  const { status, user, groups, refresh, confirmName, claimEmail, logout } = useSession();
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [claimUrl, setClaimUrl] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [groupName, setGroupName] = React.useState("");
  const [joinCode, setJoinCode] = React.useState("");
  const [groupSubmitting, setGroupSubmitting] = React.useState(false);
  const [confirmNameInput, setConfirmNameInput] = React.useState("");
  const [confirmingName, setConfirmingName] = React.useState(false);

  // Signal from GET /api/auth/google/callback (task 3's brief): a brand-new
  // Google sign-in redirects here with ?welcome=1 so the one-time "what's
  // your name" prompt can render immediately, without a second round trip.
  // Read once on mount — this is a one-time signal, not something that
  // should reappear on every re-render of this route.
  const [showWelcomeParam, setShowWelcomeParam] = React.useState(
    () => new URLSearchParams(window.location.search).get("welcome") === "1"
  );
  const [googleError] = React.useState(
    () => new URLSearchParams(window.location.search).get("google_error") === "1"
  );
  React.useEffect(() => {
    if (showWelcomeParam || googleError) {
      const url = new URL(window.location.href);
      url.searchParams.delete("welcome");
      url.searchParams.delete("google_error");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, [showWelcomeParam, googleError]);

  // /api/me's own needsNamePrompt is the source of truth (it survives a
  // refresh even after the one-time ?welcome=1 query param is stripped);
  // the query param just lets the prompt render on the very first paint
  // after the redirect, before the first /api/me round trip resolves.
  const showNamePrompt = status === "signed-in" && user !== null && (user.needsNamePrompt || showWelcomeParam);

  async function handleConfirmNameSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setConfirmingName(true);
    try {
      await confirmName(confirmNameInput);
      // showWelcomeParam is a one-time signal from the ?welcome=1 redirect
      // (set once, on mount, so the prompt renders on first paint before
      // /api/me resolves) — without clearing it here, it stays true forever
      // and keeps forcing the prompt open even after the server-side
      // needsNamePrompt flips to false, since showNamePrompt ORs the two.
      setShowWelcomeParam(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setConfirmingName(false);
    }
  }

  async function handleClaimSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await claimEmail(email);
      // No email provider yet (docs/DECISIONS.md) — show the link directly
      // instead of sending it.
      setClaimUrl(result.claimUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setGroupSubmitting(true);
    try {
      await createGroupRequest(groupName);
      setGroupName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the group");
    } finally {
      setGroupSubmitting(false);
    }
  }

  async function handleJoinGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setGroupSubmitting(true);
    try {
      await joinGroupRequest(joinCode);
      setJoinCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join the group");
    } finally {
      setGroupSubmitting(false);
    }
  }

  return (
    <main className="bg-background flex min-h-screen flex-col items-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <p className="text-primary text-center text-xs font-bold tracking-[0.3em] uppercase">ColdTake</p>

        {status === "loading" && (
          <div className="flex justify-center" role="status" aria-live="polite">
            <div className="border-muted border-t-primary size-8 animate-spin rounded-full border-4" />
          </div>
        )}

        {/* Google is now the only entry path (product owner's decision,
            2026-08-21: anonymous name-only entry was a real liability — a
            lost session cookie meant a permanently orphaned account with no
            recovery path). POST /api/auth/anonymous itself is untouched —
            existing accounts created before this change keep working via
            their existing session cookie — this only removes the
            *new-signup* UI path, not the backend endpoint. */}
        {status === "signed-out" && (
          <div className="flex flex-col gap-4 text-center">
            <div>
              <h1 className="font-score text-3xl">Welcome to ColdTake</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Sign in with Google to make your picks.
              </p>
            </div>

            {/* Real top-level navigation, not a fetch — Google's own
                consent screen has to load. */}
            <a
              href="/api/auth/google"
              className="border-input bg-card hover:bg-accent flex h-14 items-center justify-center gap-2 rounded-lg border text-base font-bold shadow-xs transition-colors"
            >
              Sign in with Google
            </a>

            {googleError && (
              <p className="text-muted-foreground text-sm">
                Google sign-in didn&apos;t go through. Please try again.
              </p>
            )}
          </div>
        )}

        {/* One-time name prompt (product owner's decision, this session's
            brief): a brand-new Google sign-in has no chosen name yet — just
            a placeholder derived from their Google profile — so ask once,
            immediately after the redirect, before showing the rest of the
            app. */}
        {status === "signed-in" && user && showNamePrompt && (
          <form onSubmit={handleConfirmNameSubmit} className="flex flex-col gap-4 text-center">
            <div>
              <h1 className="font-score text-3xl">What should we call you?</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                You&apos;re signed in with Google — just pick the name your groups will see.
              </p>
            </div>
            <input
              id="confirmDisplayName"
              name="confirmDisplayName"
              className={`${fieldClass} text-center text-lg`}
              value={confirmNameInput}
              onChange={(event) => setConfirmNameInput(event.target.value)}
              placeholder={user.displayName}
              autoComplete="nickname"
              autoFocus
              required
            />
            <Button
              type="submit"
              size="lg"
              className="h-14 text-base font-bold shadow-lg"
              disabled={confirmingName || confirmNameInput.trim().length === 0}
            >
              {confirmingName ? "Saving…" : "Continue"}
            </Button>
          </form>
        )}

        {status === "signed-in" && user && !showNamePrompt && (
          <div className="flex flex-col gap-8">
            <div className="flex items-center gap-3">
              <IdentityBadge seed={user.displayName} size="lg" />
              <div>
                <p className="font-medium">{user.displayName}</p>
                {user.email && <p className="text-muted-foreground text-xs">{user.email}</p>}
              </div>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void logout()}>
                Sign out
              </Button>
            </div>

            {/* Multi-group home screen (doc 01 §7.2: "one identity, one home
                screen, all their groups") — works whether the user is in 0, 1,
                or many groups. */}
            <div className="flex flex-col gap-3">
              <h2 className="text-muted-foreground text-xs font-bold tracking-widest uppercase">
                Your groups
              </h2>
              {groups.length === 0 && (
                <div className="border-border bg-card flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-8 text-center">
                  <p className="font-medium">No groups yet</p>
                  <p className="text-muted-foreground text-sm">
                    Start one below, or join with a code from a friend.
                  </p>
                </div>
              )}
              {groups.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {groups.map((g) => (
                    <li key={g.id}>
                      <Link
                        className="border-border bg-card hover:border-primary/50 flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors"
                        to={`/groups/${g.id}`}
                      >
                        <IdentityBadge seed={g.name} shape="square" />
                        <span className="flex-1 font-medium">{g.name}</span>
                        <span className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">
                          {g.role}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form onSubmit={handleCreateGroup} className="flex flex-col gap-2">
              <label htmlFor="groupName" className="text-sm font-medium">
                Start a group
              </label>
              <input
                id="groupName"
                name="groupName"
                className={fieldClass}
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Group name"
                required
              />
              <Button type="submit" disabled={groupSubmitting || groupName.trim().length === 0}>
                {groupSubmitting ? "Creating…" : "Create group"}
              </Button>
            </form>

            <form onSubmit={handleJoinGroup} className="flex flex-col gap-2">
              <label htmlFor="joinCode" className="text-sm font-medium">
                Join with a code
              </label>
              <input
                id="joinCode"
                name="joinCode"
                className={`${fieldClass} uppercase`}
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                placeholder="ABC234"
                maxLength={6}
                required
              />
              <Button
                type="submit"
                variant="outline"
                disabled={groupSubmitting || joinCode.trim().length === 0}
              >
                {groupSubmitting ? "Joining…" : "Join group"}
              </Button>
            </form>

            {!user.email && !claimUrl && (
              <form onSubmit={handleClaimSubmit} className="flex flex-col gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Attach an email so you can sign in on another device
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className={fieldClass}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                />
                <Button type="submit" variant="outline" disabled={submitting || email.trim().length === 0}>
                  {submitting ? "Sending…" : "Send magic link"}
                </Button>
              </form>
            )}

            {claimUrl && (
              <p className="text-muted-foreground text-sm break-all">
                No email provider is wired up yet, so here is your magic link directly:{" "}
                <a className="underline" href={claimUrl}>
                  {claimUrl}
                </a>
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
