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
  const { status } = useSession();

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
      setJoined(true);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join the group");
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-4 text-center">
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

      <h1 className="text-2xl font-semibold">ColdTake</h1>

      {!code && <p className="text-muted-foreground text-sm">This invite link is missing a join code.</p>}

      {code && !groupName && !loadError && <p className="text-muted-foreground text-sm">Loading invite…</p>}

      {loadError && <p className="text-destructive text-sm">{loadError}</p>}

      {groupName && !joined && (
        <>
          <p>
            You're invited to join <strong>{groupName}</strong>.
          </p>

          {status === "signed-in" && (
            <Button type="button" disabled={joining} onClick={() => void handleJoin()}>
              {joining ? "Joining…" : `Join ${groupName}`}
            </Button>
          )}

          {status === "signed-out" && (
            <p className="text-muted-foreground text-sm">
              <Link className="underline" to="/">
                Sign in
              </Link>{" "}
              first, then come back to this link to join.
            </p>
          )}

          {joinError && <p className="text-destructive text-sm">{joinError}</p>}
        </>
      )}

      {joined && (
        <p>
          You're in! <Link className="underline" to="/">Go to your groups</Link>
        </p>
      )}
    </main>
  );
}
