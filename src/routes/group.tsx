import * as React from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/group";
import { useSession, useUser } from "@/lib/session/use-session";
import {
  fetchGroupDetail,
  removeGroupMember,
  promoteGroupAdmin,
  demoteGroupAdmin,
} from "@/lib/groups/client";
import type { GroupDetailResponse, GroupSeasonSummary } from "@/lib/schemas/groups";
import { Button } from "@/components/ui/button";

// Where a season's "open this season" link goes, keyed by its effective
// status (src/lib/seasons/state.ts) — this hardening session's fix: before
// this, a group's seasons weren't listed anywhere in the UI at all, so
// there was no way back into a season page except the moment right after
// creating it.
//
// Bug fix (tonight): `draft` used to return null here, which the caller
// rendered as inert "Not published yet" text — clicking a draft season did
// nothing, and there was no route at all for a draft anyway (season-picks
// is for `open`/post-publish seasons, reveal/standings are for
// locked/settled/voided). src/routes/season-new.tsx now has an edit mode
// (`/groups/:groupId/seasons/:seasonId/edit`) that loads an existing draft
// instead of only creating new ones, so a draft can link straight there —
// but only for the group admin, since editing (and even just loading) a
// draft requires admin (season-new.tsx blocks non-admins outright, and
// there's nothing useful for a member to do with an unpublished slate yet).
export function seasonLinkPath(groupId: string, seasonRow: GroupSeasonSummary, isAdmin: boolean): string | null {
  switch (seasonRow.status) {
    case "open":
      return `/groups/${groupId}/seasons/${seasonRow.id}/picks`;
    case "locked":
    case "settled":
      return `/groups/${groupId}/seasons/${seasonRow.id}/reveal`;
    case "voided":
      return `/groups/${groupId}/seasons/${seasonRow.id}/standings`;
    case "draft":
      return isAdmin ? `/groups/${groupId}/seasons/${seasonRow.id}/edit` : null;
  }
}

const SEASON_STATUS_LABEL: Record<GroupSeasonSummary["status"], string> = {
  draft: "Draft",
  open: "Open — picks are being made",
  locked: "Locked — picks are revealed",
  settled: "Settled",
  voided: "Voided",
};

export function meta(_: Route.MetaArgs) {
  return [{ title: "Group | ColdTake" }];
}

// Group page (this session's brief, task 4): group info + member list, with
// admin-only remove/transfer actions. Plain functional UI, shadcn defaults —
// no visual design work yet (deferred per docs/DECISIONS.md, session 14).
export default function GroupPage() {
  const { groupId } = useParams();
  const user = useUser();
  const { status } = useSession();
  const [detail, setDetail] = React.useState<GroupDetailResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Starts true (not reset to true inside the effect below) so the mount
  // effect only ever needs to turn it off — resetting it back on inside an
  // effect body is exactly the "setState synchronously in an effect"
  // pattern react-hooks/set-state-in-effect flags.
  const [loading, setLoading] = React.useState(true);
  const [busyMemberId, setBusyMemberId] = React.useState<string | null>(null);

  // Reusable for the "reload after an admin action" case below — kept
  // separate from the mount effect, which does its own fetch-then-setState
  // inline (same "sync with an external system on mount" shape as
  // src/lib/session/provider.tsx's refresh effect) so the effect body never
  // calls setState through an intermediate function.
  const reload = React.useCallback(async () => {
    if (!groupId) return;
    setError(null);
    try {
      setDetail(await fetchGroupDetail(groupId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the group");
    }
  }, [groupId]);

  React.useEffect(() => {
    if (status !== "signed-in" || !groupId) {
      return;
    }
    let cancelled = false;
    fetchGroupDetail(groupId)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load the group");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, groupId]);

  if (!groupId) {
    return <p className="p-4">Missing group id.</p>;
  }
  if (status === "loading" || loading) {
    return <p className="text-muted-foreground p-4">Loading…</p>;
  }
  if (status === "signed-out") {
    return (
      <main className="p-4">
        <p>
          You need to sign in first. <Link className="underline" to="/">Go home</Link>
        </p>
      </main>
    );
  }
  if (error || !detail) {
    return <p className="text-destructive p-4">{error ?? "Group not found"}</p>;
  }

  const currentMembership = detail.members.find((m) => m.userId === user?.id);
  const isAdmin = currentMembership?.role === "admin";
  const adminCount = detail.members.filter((m) => m.role === "admin").length;
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const inviteUrl = `${appUrl}/join?code=${detail.group.joinCode}`;

  // These two used to report failure via the same buried inline <p> at the
  // bottom of the page as everything else here (bug 1's report, same
  // pattern as season-new.tsx's publish flow) — for a destructive/admin
  // action below a long member list, that error was easy to scroll past
  // entirely. Toasts with a retry action fix that the same way.
  async function handleRemove(memberId: string) {
    if (!groupId) return;
    setBusyMemberId(memberId);
    try {
      await removeGroupMember(groupId, memberId);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that member", {
        action: { label: "Retry", onClick: () => void handleRemove(memberId) },
      });
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handlePromote(memberId: string) {
    if (!groupId) return;
    setBusyMemberId(memberId);
    try {
      await promoteGroupAdmin(groupId, memberId);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not make that member an admin", {
        action: { label: "Retry", onClick: () => void handlePromote(memberId) },
      });
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleDemote(memberId: string) {
    if (!groupId) return;
    setBusyMemberId(memberId);
    try {
      await demoteGroupAdmin(groupId, memberId);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that admin", {
        action: { label: "Retry", onClick: () => void handleDemote(memberId) },
      });
    } finally {
      setBusyMemberId(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4">
      {/* Session 13, task 6: an admin previewing/copying this page's invite
          link benefits from the same real preview a recipient would see —
          React 19 hoists these into <head> (see src/routes/join.tsx's
          longer comment on the same pattern). */}
      <title>{`${detail.group.name} | ColdTake`}</title>
      <meta property="og:title" content={`Join ${detail.group.name} on ColdTake`} />
      <meta property="og:url" content={inviteUrl} />

      <Link className="text-muted-foreground text-sm underline" to="/">
        ← All groups
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{detail.group.name}</h1>
        <p className="text-muted-foreground text-sm">
          Join code: <strong>{detail.group.joinCode}</strong>
        </p>
        <p className="text-muted-foreground text-sm break-all">
          Invite link: <a className="underline" href={inviteUrl}>{inviteUrl}</a>
        </p>
      </div>

      {isAdmin && (
        <Link
          className="text-sm underline"
          to={`/groups/${groupId}/seasons/new`}
        >
          + Set up a season
        </Link>
      )}

      {/* Season list (this hardening session's fix, doc 04's "a group with
          no seasons yet" empty state, and the only navigable way back into
          a season a member didn't just create). */}
      <div>
        <h2 className="mb-2 font-medium">Seasons</h2>
        {detail.seasons.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No seasons yet.
            {isAdmin
              ? " Set one up above to get started."
              : " Check back once an admin sets one up."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.seasons.map((seasonRow) => {
              const path = seasonLinkPath(groupId, seasonRow, isAdmin);
              return (
                <li
                  key={seasonRow.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{seasonRow.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {SEASON_STATUS_LABEL[seasonRow.status]}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    {path ? (
                      <Link className="underline" to={path}>
                        {seasonRow.status === "draft" ? "Continue setup →" : "Open →"}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {seasonRow.status === "draft" ? "Not published yet" : "Not available"}
                      </span>
                    )}
                    {/* Leaderboard is reachable regardless of season status
                        (bug fix, tonight): seasonLinkPath above only ever
                        points a season's one link at picks/reveal/edit —
                        `open` and `locked` seasons had no dashboard link to
                        standings at all, so a member had no way in short of
                        guessing the URL. recomputeStandings itself allows
                        any non-draft, non-voided status (locked/settled)
                        plus open (projected standings), so the same set
                        gets a link here; voided already got one via
                        seasonLinkPath and standings there is empty/historic
                        only, not worth a second identical link. */}
                    {seasonRow.status !== "draft" && seasonRow.status !== "voided" && (
                      <Link
                        className="text-muted-foreground underline"
                        to={`/groups/${groupId}/seasons/${seasonRow.id}/standings`}
                      >
                        Leaderboard →
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-2 font-medium">Members ({detail.members.length})</h2>
        <ul className="flex flex-col gap-2">
          {detail.members.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span>
                {member.displayName}
                {member.role === "admin" && (
                  <span className="text-muted-foreground ml-2 text-xs uppercase">Admin</span>
                )}
              </span>
              {isAdmin && member.userId !== user?.id && (
                <span className="flex gap-2">
                  {member.role === "admin" ? (
                    // Any admin who isn't the group's last one can be
                    // demoted by any other admin — the last admin can't be,
                    // so this codebase never leaves a group with zero.
                    adminCount > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyMemberId === member.id}
                        onClick={() => void handleDemote(member.id)}
                      >
                        Remove admin
                      </Button>
                    )
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyMemberId === member.id}
                      onClick={() => void handlePromote(member.id)}
                    >
                      Make admin
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busyMemberId === member.id || (member.role === "admin" && adminCount <= 1)}
                    onClick={() => void handleRemove(member.id)}
                  >
                    Remove
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
