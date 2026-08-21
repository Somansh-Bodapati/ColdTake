import * as React from "react";
import { Link, useSearchParams } from "react-router";
import type { Route } from "./+types/join";
import { useSession } from "@/lib/session/use-session";
import { fetchGroupPreviewByCode, joinGroupRequest } from "@/lib/groups/client";
import { Button } from "@/components/ui/button";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Join a group | ColdTake" },
    { property: "og:title", content: "Join a group on ColdTake" },
    {
      property: "og:description",
      content: "A season-long sports prediction game for your friend group. No money, ever.",
    },
    { property: "og:type", content: "website" },
  ];
}

// The join-by-code landing page (this session's brief, task 6) — the
// destination every invite link (group.tsx's inviteUrl, api/groups/index.ts's
// inviteUrl) and every share card's footer (src/lib/cards/element.ts's
// cardFooter) actually points at. Doc 01 §6.1: "Every card pasted into
// WhatsApp is seen by people who aren't users yet" — this page is the first
// thing they land on, so it works without a session (public preview via
// GET /api/groups/by-code/:code) and only asks for a name once they've
// decided to join.
//
// Open Graph note: react-router.config.ts sets `ssr: false` (this app is a
// static SPA build) — the <meta property="og:*"> tags below render into
// <head> for real browsers and any preview tool that executes JS, but a
// crawler that fetches raw HTML without running JS (some link-unfurl bots)
// won't see the group-name-specific ones since there's no server render for
// this route. Fixing that fully would mean adding SSR or a prerendered
// route for this one page — out of this session's scope; the tags
// themselves are still correct doc 06.1 was ask for.
export default function JoinPage() {
  const [searchParams] = useSearchParams();
  const code = (searchParams.get("code") ?? "").trim().toUpperCase();
  const { status, refresh } = useSession();

  const [groupName, setGroupName] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const [joined, setJoined] = React.useState(false);
  const [joining, setJoining] = React.useState(false);

  React.useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetchGroupPreviewByCode(code)
      .then((preview) => {
        if (!cancelled) setGroupName(preview.name);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Invite link not found");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function handleJoin() {
    setJoinError(null);
    setJoining(true);
    try {
      await joinGroupRequest(code);
      // Same pattern as home.tsx's join-by-code form: the session's group
      // list lives in SessionProvider state, fetched once on mount, so a
      // join anywhere else in the app has to explicitly refresh it — a bare
      // navigate("/") to the home route would otherwise show the stale
      // (pre-join) list until something else happens to call refresh().
      await refresh();
      setJoined(true);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join the group");
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="bg-background flex min-h-screen flex-col">
      {/* React 19 hoists <title>/<meta> rendered anywhere in the tree into
          <head> — this is what makes the OG tags reflect the actual group
          name once the public preview loads, on top of the static meta()
          fallback above. */}
      {groupName && (
        <>
          <title>{`Join ${groupName} | ColdTake`}</title>
          <meta property="og:title" content={`Join ${groupName} on ColdTake`} />
          <meta
            property="og:description"
            content={`${groupName} is playing a season-long prediction game. Join in — free, no money, ever.`}
          />
        </>
      )}

      {/* Invite landing (docs/05-DESIGN-PROMPT.md §1): "sell the game in
          three seconds... one dominant Join action... must not look like a
          signup funnel." One screen, one hero, one button — no card chrome,
          no secondary CTAs competing with Join. */}
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-16 text-center">
        <p className="text-primary text-xs font-bold tracking-[0.3em] uppercase">ColdTake</p>

        {!code && (
          <p className="text-muted-foreground text-sm">This invite link is missing a join code.</p>
        )}

        {code && !groupName && !loadError && (
          <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
            <div className="border-muted border-t-primary size-8 animate-spin rounded-full border-4" />
            <p className="text-muted-foreground text-sm">Loading the invite…</p>
          </div>
        )}

        {loadError && (
          <div className="border-destructive/40 bg-destructive/10 rounded-lg border px-4 py-3">
            <p className="text-destructive text-sm font-medium">{loadError}</p>
          </div>
        )}

        {groupName && !joined && (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="font-score text-4xl leading-[1.05] text-balance sm:text-5xl">
                {groupName}
              </h1>
              <p className="text-muted-foreground text-base">
                is picking a champion this season. No money, no odds — just bragging rights.
              </p>
            </div>

            {status === "signed-in" && (
              <Button
                type="button"
                size="lg"
                className="h-14 w-full text-base font-bold shadow-lg"
                disabled={joining}
                onClick={() => void handleJoin()}
              >
                {joining ? "Joining…" : `Join ${groupName}`}
              </Button>
            )}

            {status === "signed-out" && (
              <Button asChild size="lg" className="h-14 w-full text-base font-bold shadow-lg">
                <Link to="/">Join {groupName}</Link>
              </Button>
            )}

            {joinError && <p className="text-destructive text-sm">{joinError}</p>}
          </>
        )}

        {joined && (
          <div className="flex flex-col items-center gap-3">
            <span className="bg-positive/15 text-positive rounded-full px-4 py-1 text-sm font-bold">
              You're in
            </span>
            <Button asChild size="lg" className="h-14 w-full text-base font-bold">
              <Link to="/">Go to your groups</Link>
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
