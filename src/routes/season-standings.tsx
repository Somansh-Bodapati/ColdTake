import * as React from "react";
import { Link, useParams } from "react-router";
import type { Route } from "./+types/season-standings";
import { useSession, useUser } from "@/lib/session/use-session";
import { fetchSeasonDetail } from "@/lib/seasons/client";
import { fetchGroupDetail } from "@/lib/groups/client";
import { fetchLatestStandings, recomputeStandings } from "@/lib/standings/client";
import type { SeasonDetailResponse } from "@/lib/schemas/seasons";
import type { GroupDetailResponse } from "@/lib/schemas/groups";
import type { StandingsBreakdownEntry, StandingsSnapshotResponse } from "@/lib/schemas/standings";
import { Button } from "@/components/ui/button";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Standings | ColdTake" }];
}

const STATUS_LABEL: Record<StandingsBreakdownEntry["status"], string> = {
  correct: "Correct",
  partial: "Partial",
  incorrect: "Incorrect",
  pending: "Pending",
  no_pick: "No pick",
};

// Leaderboard + per-member breakdown (this session's brief, task 4). The
// page issues exactly one DB query on load per resource it needs: one call
// to GET /api/seasons/:id/standings (src/lib/standings/service.ts's
// getLatestSnapshot — a single indexed row read off standings_snapshot,
// with displayName already denormalized into that row at write time), plus
// the season/group detail calls every other season page already makes for
// its own chrome. Expanding a member's breakdown below is purely a client-
// side toggle over data already in that one response — no extra fetch,
// no N+1 (task 5).
export default function SeasonStandingsPage() {
  const { groupId, seasonId } = useParams();
  const user = useUser();
  const { status } = useSession();

  const [season, setSeason] = React.useState<SeasonDetailResponse | null>(null);
  const [group, setGroup] = React.useState<GroupDetailResponse | null>(null);
  const [snapshot, setSnapshot] = React.useState<StandingsSnapshotResponse | null>(null);
  const [expandedMemberId, setExpandedMemberId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [recomputing, setRecomputing] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!seasonId || !groupId) return;
    setError(null);
    try {
      const [seasonDetail, groupDetail, latest] = await Promise.all([
        fetchSeasonDetail(seasonId),
        fetchGroupDetail(groupId),
        fetchLatestStandings(seasonId),
      ]);
      setSeason(seasonDetail);
      setGroup(groupDetail);
      setSnapshot(latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load standings");
    }
  }, [seasonId, groupId]);

  React.useEffect(() => {
    if (status !== "signed-in" || !seasonId || !groupId) {
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchSeasonDetail(seasonId),
      fetchGroupDetail(groupId),
      fetchLatestStandings(seasonId),
    ])
      .then(([seasonDetail, groupDetail, latest]) => {
        if (cancelled) return;
        setSeason(seasonDetail);
        setGroup(groupDetail);
        setSnapshot(latest);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load standings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, seasonId, groupId]);

  async function handleRecompute() {
    if (!seasonId) return;
    setRecomputing(true);
    setError(null);
    try {
      await recomputeStandings(seasonId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not recompute standings");
    } finally {
      setRecomputing(false);
    }
  }

  if (!groupId || !seasonId) {
    return <p className="p-4">Missing route parameters.</p>;
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
  if (error || !season || !group) {
    return <p className="text-destructive p-4">{error ?? "Season not found"}</p>;
  }

  const isAdmin = group.members.find((m) => m.userId === user?.id)?.role === "admin";

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4">
      <Link className="text-muted-foreground text-sm underline" to={`/groups/${groupId}`}>
        ← Back to group
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{season.season.name} — standings</h1>
        {snapshot && (
          <p className="text-muted-foreground text-sm">
            As of {new Date(snapshot.computedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* doc 03 §2.5: "UI must label projected standings unambiguously.
          Never show a projected number in the same visual treatment as a
          settled one." — a persistent banner plus a per-row badge, not just
          one or the other. */}
      {snapshot?.isProjected && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Projected standings — the season isn't settled yet. Points may still change.
        </p>
      )}

      {isAdmin && (
        <Button type="button" size="sm" variant="outline" disabled={recomputing} onClick={() => void handleRecompute()}>
          {recomputing ? "Recomputing…" : "Recompute standings"}
        </Button>
      )}

      {!snapshot && (
        <p className="text-muted-foreground text-sm">
          No standings have been computed yet.
          {isAdmin ? " Use Recompute above to generate the first one." : ""}
        </p>
      )}

      {snapshot && snapshot.standings.length === 0 && (
        <p className="text-muted-foreground text-sm">No members to rank yet.</p>
      )}

      {snapshot && snapshot.standings.length > 0 && (
        <ol className="flex flex-col gap-2">
          {snapshot.standings.map((entry) => {
            const expanded = expandedMemberId === entry.memberId;
            return (
              <li key={entry.memberId} className="rounded-md border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
                  onClick={() => setExpandedMemberId(expanded ? null : entry.memberId)}
                >
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground w-6 text-right font-mono">#{entry.rank}</span>
                    <span className="font-medium">{entry.displayName}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {entry.delta !== 0 && (
                      <span className={entry.delta > 0 ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
                        {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                      </span>
                    )}
                    <span className="font-mono">{entry.points} pts</span>
                    {snapshot.isProjected && (
                      <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">
                        Projected
                      </span>
                    )}
                  </span>
                </button>

                {expanded && (
                  <ul className="flex flex-col gap-1 border-t px-3 py-2">
                    {entry.breakdown.map((item) => (
                      <li key={item.questionId} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {season.questions.find((q) => q.id === item.questionId)?.prompt ?? item.questionId}
                        </span>
                        <span className="flex items-center gap-2">
                          <span>{STATUS_LABEL[item.status]}</span>
                          {item.boldnessMultiplier !== 1 && (
                            <span className="text-muted-foreground">×{item.boldnessMultiplier.toFixed(2)}</span>
                          )}
                          <span className="font-mono">
                            {item.points}/{item.maxPossible}
                          </span>
                        </span>
                      </li>
                    ))}
                    {entry.breakdown.length === 0 && (
                      <li className="text-muted-foreground text-xs">No slate.</li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
