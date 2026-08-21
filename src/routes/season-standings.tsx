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
import { ShareCardButton } from "@/components/share-card-button";
import { buildCardUrl } from "@/lib/cards/client";
import { IdentityBadge } from "@/components/identity-badge";
import { cn } from "@/lib/utils";

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
    return (
      <main className="mx-auto flex max-w-lg flex-col gap-4 p-4">
        <div className="bg-muted h-4 w-32 animate-pulse rounded" />
        <div className="bg-muted h-8 w-56 animate-pulse rounded" />
        <div className="flex flex-col gap-2 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-muted h-14 animate-pulse rounded-xl" />
          ))}
        </div>
      </main>
    );
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
    return (
      <main className="mx-auto flex max-w-lg flex-col gap-3 p-4">
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
          {error ?? "Season not found"}
        </p>
        <p className="text-muted-foreground text-sm">
          The last-known standings couldn't be loaded either. Try again shortly.
        </p>
      </main>
    );
  }

  const isAdmin = group.members.find((m) => m.userId === user?.id)?.role === "admin";
  const isFinal = snapshot ? !snapshot.isProjected : false;

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4">
      <Link className="text-muted-foreground text-sm underline" to={`/groups/${groupId}`}>
        ← Back to group
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{season.season.name}</h1>
        {snapshot && (
          <p className="text-muted-foreground text-sm">
            As of {new Date(snapshot.computedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* doc 03 §2.5: "UI must label projected standings unambiguously.
          Never show a projected number in the same visual treatment as a
          settled one." A full-width banner, distinct type colour, and a
          per-row badge together — never relying on just one signal. */}
      {snapshot && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-bold",
            isFinal ? "bg-positive/15 text-positive" : "bg-primary/15 text-primary"
          )}
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              isFinal ? "bg-positive" : "bg-primary animate-pulse"
            )}
          />
          {isFinal
            ? "Final standings — the season is settled."
            : "Projected standings — the season isn't settled yet. Points may still change."}
        </div>
      )}

      {/* Share card (this session's brief, task 7): the immutable card URL
          is built from the snapshot's own computedAt, already in hand from
          the fetch above — never a freshly-minted "now". */}
      {snapshot && (
        <ShareCardButton
          cardUrl={buildCardUrl("standings", seasonId, snapshot.computedAt)}
          title={`${group.group.name} standings`}
          text={`See where everyone stands in ${season.season.name} — join ${group.group.name} on ColdTake.`}
          fileName={`${group.group.name}-standings.png`}
        />
      )}

      {isAdmin && (
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={recomputing} onClick={() => void handleRecompute()}>
            {recomputing ? "Recomputing…" : "Recompute standings"}
          </Button>
          <Link
            className="text-muted-foreground text-sm underline"
            to={`/groups/${groupId}/seasons/${seasonId}/manual-standings`}
          >
            Enter standings manually
          </Link>
        </div>
      )}

      {!snapshot && (
        <div className="border-border bg-card flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-8 text-center">
          <p className="font-medium">No standings yet</p>
          <p className="text-muted-foreground text-sm">
            {isAdmin ? "Use Recompute above to generate the first one." : "Check back once the season gets going."}
          </p>
        </div>
      )}

      {snapshot && snapshot.standings.length === 0 && (
        <p className="text-muted-foreground text-sm">No members to rank yet.</p>
      )}

      {snapshot && snapshot.standings.length > 0 && (
        <ol className="flex flex-col gap-2">
          {snapshot.standings.map((entry) => {
            const expanded = expandedMemberId === entry.memberId;
            const isTop = entry.rank === 1;
            return (
              <li
                key={entry.memberId}
                className={cn(
                  "bg-card overflow-hidden rounded-xl border",
                  isTop && isFinal ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "border-border"
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  onClick={() => setExpandedMemberId(expanded ? null : entry.memberId)}
                >
                  <span
                    className={cn(
                      "font-score w-7 shrink-0 text-right text-lg",
                      isTop ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {entry.rank}
                  </span>
                  <IdentityBadge seed={entry.displayName} />
                  <span className="flex-1 truncate font-medium">{entry.displayName}</span>
                  {entry.delta !== 0 && (
                    <span
                      className={cn(
                        "font-score text-xs",
                        entry.delta > 0 ? "text-positive" : "text-destructive"
                      )}
                    >
                      {entry.delta > 0 ? `▲ ${entry.delta}` : `▼ ${Math.abs(entry.delta)}`}
                    </span>
                  )}
                  <span className="font-score text-base">{entry.points}</span>
                  {snapshot.isProjected && (
                    <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase">
                      Proj
                    </span>
                  )}
                </button>

                {expanded && (
                  <ul className="border-border flex flex-col gap-1 border-t px-4 py-3">
                    {entry.breakdown.map((item) => (
                      <li key={item.questionId} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate pr-2">
                          {season.questions.find((q) => q.id === item.questionId)?.prompt ?? item.questionId}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span
                            className={cn(
                              item.status === "correct" && "text-positive",
                              item.status === "incorrect" && "text-destructive"
                            )}
                          >
                            {STATUS_LABEL[item.status]}
                          </span>
                          {item.boldnessMultiplier !== 1 && (
                            <span className="text-muted-foreground">×{item.boldnessMultiplier.toFixed(2)}</span>
                          )}
                          <span className="font-score">
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
