import * as React from "react";
import { Link, useParams } from "react-router";
import type { Route } from "./+types/group";
import { useSession, useUser } from "@/lib/session/use-session";
import {
  fetchGroupDetail,
  removeGroupMember,
  transferGroupAdmin,
} from "@/lib/groups/client";
import type { GroupDetailResponse } from "@/lib/schemas/groups";
import { Button } from "@/components/ui/button";

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
  const appUrl = typeof window !== "undefined" ? window.location.origin : "";
  const inviteUrl = `${appUrl}/join?code=${detail.group.joinCode}`;

  async function handleRemove(memberId: string) {
    if (!groupId) return;
    setBusyMemberId(memberId);
    setError(null);
    try {
      await removeGroupMember(groupId, memberId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that member");
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleTransfer(memberId: string) {
    if (!groupId) return;
    setBusyMemberId(memberId);
    setError(null);
    try {
      await transferGroupAdmin(groupId, memberId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not transfer the admin role");
    } finally {
      setBusyMemberId(null);
    }
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4">
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyMemberId === member.id}
                    onClick={() => void handleTransfer(member.id)}
                  >
                    Make admin
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busyMemberId === member.id}
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

      {error && <p className="text-destructive text-sm">{error}</p>}
    </main>
  );
}
