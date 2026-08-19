import * as React from "react";
import { Link } from "react-router";
import type { Route } from "./+types/home";
import { useSession } from "@/lib/session/use-session";
import { createGroupRequest, joinGroupRequest } from "@/lib/groups/client";
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
  const { status, user, groups, refresh, signInAnonymous, claimEmail, logout } = useSession();
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [claimUrl, setClaimUrl] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [groupName, setGroupName] = React.useState("");
  const [joinCode, setJoinCode] = React.useState("");
  const [groupSubmitting, setGroupSubmitting] = React.useState(false);

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

          {/* Multi-group home screen (doc 01 §7.2: "one identity, one home
              screen, all their groups") — works whether the user is in 0, 1,
              or many groups. */}
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Your groups</h2>
            {groups.length === 0 && (
              <p className="text-muted-foreground text-sm">
                You're not in any groups yet — start one or join with a code.
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link className="underline" to={`/groups/${g.id}`}>
                    {g.name}
                  </Link>{" "}
                  <span className="text-muted-foreground text-xs uppercase">{g.role}</span>
                </li>
              ))}
            </ul>
          </div>

          <form onSubmit={handleCreateGroup} className="flex flex-col gap-2">
            <label htmlFor="groupName" className="text-sm font-medium">
              Start a group
            </label>
            <input
              id="groupName"
              name="groupName"
              className="border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs"
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
              className="border-input rounded-md border bg-transparent px-3 py-2 text-sm uppercase shadow-xs"
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
