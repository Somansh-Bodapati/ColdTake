import * as React from "react";
import { Link, useParams } from "react-router";
import type { Route } from "./+types/season-reveal";
import { useSession } from "@/lib/session/use-session";
import { fetchSeasonDetail } from "@/lib/seasons/client";
import { fetchAllPicks } from "@/lib/picks/client";
import type { SeasonDetailResponse } from "@/lib/schemas/seasons";
import type { AllPicksResponse, PickAnswerInput } from "@/lib/schemas/picks";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reveal | ColdTake" }];
}

function formatAnswer(answer: PickAnswerInput): string {
  if (answer.teamId) return answer.teamId;
  if (answer.teamIds && answer.teamIds.length > 0) return answer.teamIds.join(", ");
  if (answer.playerId) return answer.playerId;
  if (typeof answer.value === "number") return String(answer.value);
  if (typeof answer.bool === "boolean") return answer.bool ? "Yes" : "No";
  if (answer.optionId) return answer.optionId;
  return "—";
}

// Reveal view (this session's brief, task 5): everyone's picks, visible to
// every group member from the moment of lock (doc 01 §7.3: picks are never
// visible before lock; doc 01 §2.5 step 2: "All picks become visible to all
// group members simultaneously" — no narrower rule than "the whole group,"
// e.g. no admin-only or self-only carve-out). GET /api/seasons/:id/picks/all
// itself enforces the 403 (api/seasons/[id]/picks/all.ts) — this page's
// only extra job is turning that 403 into a legible "not yet" state rather
// than a raw error.
export default function SeasonRevealPage() {
  const { groupId, seasonId } = useParams();
  const { status } = useSession();

  const [season, setSeason] = React.useState<SeasonDetailResponse | null>(null);
  const [reveal, setReveal] = React.useState<AllPicksResponse | null>(null);
  const [notRevealedYet, setNotRevealedYet] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (status !== "signed-in" || !seasonId) {
      return;
    }
    let cancelled = false;
    fetchSeasonDetail(seasonId)
      .then(async (detail) => {
        if (cancelled) return;
        setSeason(detail);
        try {
          const picks = await fetchAllPicks(seasonId);
          if (!cancelled) setReveal(picks);
        } catch {
          // The API 403s until the season is actually locked — that's not
          // an error state for this page, just "come back after lock."
          if (!cancelled) setNotRevealedYet(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the season");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, seasonId]);

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
  if (error || !season) {
    return <p className="text-destructive p-4">{error ?? "Season not found"}</p>;
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4">
      <Link className="text-muted-foreground text-sm underline" to={`/groups/${groupId}`}>
        ← Back to group
      </Link>

      <h1 className="text-2xl font-semibold">{season.season.name} — reveal</h1>

      {notRevealedYet && (
        <p className="text-muted-foreground text-sm">
          Picks are hidden until the season locks at{" "}
          {new Date(season.season.lockAt).toLocaleString()}. Everyone will see everyone's picks at once —
          no early peeking, not even for you.
        </p>
      )}

      {reveal && (
        <div className="flex flex-col gap-4">
          {reveal.members.map((member) => (
            <div key={member.memberId} className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">{member.displayName}</p>
              {member.picks.length === 0 ? (
                <p className="text-muted-foreground text-xs">No slate — scores zero.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {season.questions.map((question) => {
                    const memberPick = member.picks.find((p) => p.questionId === question.id);
                    return (
                      <li key={question.id} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{question.prompt}</span>
                        <span>{memberPick ? formatAnswer(memberPick.answer) : "—"}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
