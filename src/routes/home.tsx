import * as React from "react";
import type { Route } from "./+types/home";
import { useSession } from "@/lib/session/use-session";
import { Button } from "@/components/ui/button";

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
  const { status, user, signInAnonymous, claimEmail, logout } = useSession();
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [claimUrl, setClaimUrl] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function handleNameSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInAnonymous(displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-semibold">ColdTake</h1>

      {status === "loading" && <p className="text-muted-foreground">Loading…</p>}

      {status === "signed-out" && (
        <form onSubmit={handleNameSubmit} className="flex w-full max-w-xs flex-col gap-3">
          <label htmlFor="displayName" className="text-sm font-medium">
            What should we call you?
          </label>
          <input
            id="displayName"
            name="displayName"
            className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name"
            autoComplete="nickname"
            required
          />
          <Button type="submit" disabled={submitting || displayName.trim().length === 0}>
            {submitting ? "Joining…" : "Start playing"}
          </Button>
        </form>
      )}

      {status === "signed-in" && user && (
        <div className="flex w-full max-w-xs flex-col gap-4">
          <p>
            Signed in as <strong>{user.displayName}</strong>
            {user.email ? ` (${user.email})` : ""}
          </p>

          {!user.email && !claimUrl && (
            <form onSubmit={handleClaimSubmit} className="flex flex-col gap-3">
              <label htmlFor="email" className="text-sm font-medium">
                Attach an email so you can sign in on another device
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
              <Button type="submit" disabled={submitting || email.trim().length === 0}>
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

          <Button variant="outline" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}
    </main>
  );
}
