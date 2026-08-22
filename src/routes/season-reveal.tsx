import * as React from "react";
import { Link, useParams } from "react-router";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import type { Route } from "./+types/season-reveal";
import { useSession } from "@/lib/session/use-session";
import { fetchSeasonDetail } from "@/lib/seasons/client";
import { fetchAllPicks } from "@/lib/picks/client";
import type { QuestionResponse, SeasonDetailResponse, TeamSummary } from "@/lib/schemas/seasons";
import type { AllPicksResponse, PickAnswerInput } from "@/lib/schemas/picks";
import { customQuestionOptions } from "@/lib/seasons/question-config";
import { ShareCardButton } from "@/components/share-card-button";
import { buildCardUrl } from "@/lib/cards/client";
import { IdentityBadge } from "@/components/identity-badge";
import { Button } from "@/components/ui/button";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Reveal | ColdTake" }];
}

// Resolves a `teamId` (the raw internal team.id every team-referencing
// resolver in src/lib/scoring/resolvers/*.ts stores — see champion.ts,
// runner-up.ts, wooden-spoon.ts, top-n-{un,}ordered.ts) to the team's real
// name, via `season.teams` (the same `TeamSummary[]` src/routes/season-picks.tsx
// already looks up teamBadgeSeed/TeamSelect against). A pick's teamId should
// always match a season team — src/lib/picks/service.ts validates every pick
// against the season's Tournament.teamIds before it's ever stored — but a
// season's roster is theoretically still just app-level data, not an FK
// constraint, so this stays defensive: show the raw id rather than an empty
// label or a crash if a match somehow isn't found.
function resolveTeam(teamId: string, teams: readonly TeamSummary[]): TeamSummary | undefined {
  return teams.find((t) => t.id === teamId);
}

// Resolves a `custom` question's `optionId` (src/lib/scoring/resolvers/custom.ts)
// to that specific question's option label, via `question.config.options`
// (the `{ id, label }[]` src/lib/schemas/seasons.ts's `customConfigSchema`
// requires at creation time). Same defensive fallback as `teamDisplayName`:
// an option should always exist for a stored pick, but show the raw id
// rather than crash if the season's question config ever gets edited out
// from under an already-submitted pick.
function customOptionLabel(question: QuestionResponse, optionId: string): string {
  const options = customQuestionOptions(question.config.options);
  return options.find((o) => o.id === optionId)?.label ?? optionId;
}

// Plain-text counterpart to <AnswerValue> below, for contexts that need a
// string rather than JSX — the per-member share text (this session's brief,
// "a share option for the individual cards"). Reuses the exact same
// resolution helpers (resolveTeam, customOptionLabel) as the on-screen
// render, so the shared text never drifts from what the card itself shows —
// real team names and option labels, never raw ids.
function answerText(question: QuestionResponse, answer: PickAnswerInput | undefined, teams: readonly TeamSummary[]): string {
  if (!answer) return "No pick";
  switch (question.type) {
    case "champion":
    case "runner_up":
    case "wooden_spoon": {
      if (!answer.teamId) return "No pick";
      const team = resolveTeam(answer.teamId, teams);
      return team ? team.name : answer.teamId;
    }
    case "top_n_unordered":
    case "top_n_ordered": {
      if (!answer.teamIds || answer.teamIds.length === 0) return "No pick";
      return answer.teamIds
        .map((teamId) => resolveTeam(teamId, teams)?.name ?? teamId)
        .join(", ");
    }
    case "custom":
      return answer.optionId ? customOptionLabel(question, answer.optionId) : "No pick";
    case "stat_leader":
      return answer.playerId ?? "No pick";
    case "numeric":
      return typeof answer.value === "number" ? String(answer.value) : "No pick";
    case "boolean":
    case "team_over_under":
      return typeof answer.bool === "boolean" ? (answer.bool ? "Yes" : "No") : "No pick";
    default:
      return "No pick";
  }
}

// Builds the text body for a single member's share (Web Share API `text`
// field, and the clipboard-fallback body) — one line per question, in the
// season's own question order, same real-name resolution as the on-screen
// slate.
export function buildMemberShareText(
  member: AllPicksResponse["members"][number],
  season: SeasonDetailResponse
): string {
  const lines = season.questions.map((question) => {
    const memberPick = member.picks.find((p) => p.questionId === question.id);
    return `${question.prompt}: ${answerText(question, memberPick?.answer, season.teams)}`;
  });
  return [`${member.displayName}'s picks for ${season.season.name}:`, ...lines].join("\n");
}

// Small icon-only share button for one member's header (this session's
// brief: not the page's whole-season <ShareCardButton>, just a compact icon
// alongside the IdentityBadge/name). No server-rendered image exists per
// member — building that Satori card type is a bigger lift than "a small
// icon" calls for tonight — so this shares plain text plus a link back to
// this reveal page, mirroring share-card-button.tsx's Web Share API /
// clipboard fallback pattern and its AbortError handling.
function MemberShareButton({
  member,
  season,
}: {
  member: AllPicksResponse["members"][number];
  season: SeasonDetailResponse;
}) {
  async function handleShare() {
    const text = buildMemberShareText(member, season);
    const url = window.location.href;

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `${member.displayName}'s picks`, text, url });
      } catch (err) {
        // AbortError is the user dismissing the native share sheet — not a
        // failure worth surfacing (same convention as share-card-button.tsx).
        if (err instanceof Error && err.name !== "AbortError") {
          toast.error("Could not open the share sheet");
        }
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Share ${member.displayName}'s picks`}
      onClick={() => void handleShare()}
    >
      <Share2 />
    </Button>
  );
}

// Every question type gets its own small answer renderer rather than one
// `formatAnswer(): string` — team-based answers need a colored IdentityBadge
// next to the resolved name (this session's "modern beauty" ask), which a
// plain string return can't carry. `playerId` (stat_leader) is rendered
// as-is: it's already human-typed free text, with no player-pool lookup to
// resolve against (src/routes/season-picks.tsx's stat_leader input has the
// same documented limitation) — not this bug, out of scope here.
function AnswerValue({
  question,
  answer,
  teams,
}: {
  question: QuestionResponse;
  answer: PickAnswerInput;
  teams: readonly TeamSummary[];
}) {
  switch (question.type) {
    case "champion":
    case "runner_up":
    case "wooden_spoon": {
      if (!answer.teamId) return <span className="text-muted-foreground">—</span>;
      return <TeamChip teamId={answer.teamId} teams={teams} />;
    }
    case "top_n_unordered":
    case "top_n_ordered": {
      if (!answer.teamIds || answer.teamIds.length === 0) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <div className="flex flex-col items-end gap-1.5">
          {answer.teamIds.map((teamId, i) => (
            <div key={`${teamId}-${i}`} className="flex items-center gap-1.5">
              {question.type === "top_n_ordered" && (
                <span className="font-score text-muted-foreground text-[11px]">{i + 1}.</span>
              )}
              <TeamChip teamId={teamId} teams={teams} />
            </div>
          ))}
        </div>
      );
    }
    case "custom":
      return answer.optionId ? (
        <span className="font-medium">{customOptionLabel(question, answer.optionId)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case "stat_leader":
      return answer.playerId ? (
        <span className="font-medium">{answer.playerId}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case "numeric":
      return typeof answer.value === "number" ? (
        <span className="font-score">{answer.value}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case "boolean":
    case "team_over_under":
      return typeof answer.bool === "boolean" ? (
        <span className="font-bold">{answer.bool ? "Yes" : "No"}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    default:
      return <span className="text-muted-foreground">—</span>;
  }
}

// A team's resolved name plus a colored IdentityBadge — real IPL brand
// colors where `identity-colors.ts`'s franchise table recognizes the name,
// the existing hash-based fallback otherwise (a group running a non-IPL
// tournament). `shortName` seeds the badge's initials, same pattern as
// season-picks.tsx's `teamBadgeSeed`.
function TeamChip({ teamId, teams }: { teamId: string; teams: readonly TeamSummary[] }) {
  const team = resolveTeam(teamId, teams);
  const seed = team ? team.shortName || team.name : teamId;
  return (
    <span className="inline-flex items-center gap-1.5">
      <IdentityBadge seed={seed} teamName={team?.name} size="sm" shape="square" />
      <span className="text-sm font-medium">{team ? team.name : teamId}</span>
    </span>
  );
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
    return (
      <main className="mx-auto flex max-w-lg flex-col gap-4 p-4">
        <div className="bg-muted h-4 w-32 animate-pulse rounded" />
        <div className="bg-muted h-8 w-56 animate-pulse rounded" />
        <div className="flex flex-col gap-3 pt-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-24 animate-pulse rounded-xl" />
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
  if (error || !season) {
    return (
      <main className="mx-auto flex max-w-lg flex-col gap-3 p-4">
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
          {error ?? "Season not found"}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4">
      <Link className="text-muted-foreground text-sm underline" to={`/groups/${groupId}`}>
        ← Back to group
      </Link>

      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-accent-foreground text-[10px] font-bold tracking-widest uppercase">Reveal</p>
          <h1 className="text-2xl font-bold">{season.season.name}</h1>
        </div>
        <Link
          className="text-muted-foreground text-sm underline"
          to={`/groups/${groupId}/seasons/${seasonId}/standings`}
        >
          Standings →
        </Link>
      </div>

      {/* Share card (this session's brief, task 7): reveal cards only exist
          once picks are actually visible, so this only ever renders after
          `reveal` has successfully loaded — mirrors the picks/all 403 gate
          the card route itself enforces. lockAt is the reveal card's
          canonical timestamp (src/lib/cards/assemble.ts). */}
      {reveal && (
        <ShareCardButton
          cardUrl={buildCardUrl("reveal", seasonId, season.season.lockAt)}
          title={`${season.season.name} — the picks are in`}
          text={`Everyone's picks just got revealed for ${season.season.name}.`}
          fileName={`${season.season.name}-reveal.png`}
        />
      )}

      {notRevealedYet && (
        <div className="border-border bg-card flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-8 text-center">
          <p className="font-medium">Picks are still under wraps</p>
          <p className="text-muted-foreground text-sm">
            Hidden until the season locks at {new Date(season.season.lockAt).toLocaleString()}. Everyone
            will see everyone's picks at once — no early peeking, not even for you.
          </p>
        </div>
      )}

      {reveal && (
        <div className="flex flex-col gap-4">
          {reveal.members.map((member) => (
            <MemberSlate key={member.memberId} member={member} season={season} />
          ))}
        </div>
      )}
    </main>
  );
}

function MemberSlate({
  member,
  season,
}: {
  member: AllPicksResponse["members"][number];
  season: SeasonDetailResponse;
}) {
  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border shadow-sm">
      <div className="border-border bg-secondary/40 flex items-center gap-3 border-b px-4 py-3">
        <IdentityBadge seed={member.displayName} />
        <span className="flex-1 truncate font-bold">{member.displayName}</span>
        <MemberShareButton member={member} season={season} />
        <span className="text-muted-foreground font-score text-xs">
          {member.picks.length}/{season.questions.length}
        </span>
      </div>
      {member.picks.length === 0 ? (
        <p className="text-muted-foreground px-4 py-4 text-sm">No slate — scores zero.</p>
      ) : (
        <ul className="flex flex-col">
          {season.questions.map((question, i) => {
            const memberPick = member.picks.find((p) => p.questionId === question.id);
            return (
              <li
                key={question.id}
                className={
                  i === 0
                    ? "flex items-start justify-between gap-3 px-4 py-3"
                    : "border-border flex items-start justify-between gap-3 border-t px-4 py-3"
                }
              >
                <span className="text-muted-foreground pt-0.5 text-sm leading-snug">{question.prompt}</span>
                <div className="shrink-0 text-right">
                  {memberPick ? (
                    <AnswerValue question={question} answer={memberPick.answer} teams={season.teams} />
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
