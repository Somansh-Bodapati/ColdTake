import * as React from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/season-picks";
import { useSession, useUser } from "@/lib/session/use-session";
import { fetchSeasonDetail, updateSeason } from "@/lib/seasons/client";
import { fetchGroupDetail } from "@/lib/groups/client";
import { fetchMyPicks, fetchReadiness, putPicks } from "@/lib/picks/client";
import type { QuestionResponse, SeasonDetailResponse, TeamSummary } from "@/lib/schemas/seasons";
import type { PickAnswerInput, ReadinessResponse } from "@/lib/schemas/picks";
import { customQuestionOptions } from "@/lib/seasons/question-config";
import { IdentityBadge } from "@/components/identity-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Your picks | ColdTake" }];
}

const inputClass =
  "border-input bg-card rounded-lg border px-3 py-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none";

// Lock countdown (docs/05-DESIGN-PROMPT.md §7: "a persistent progress
// indicator and lock countdown"). Pure formatting of a duration already in
// hand — no polling, no new fetch; the caller re-renders it every tick via
// its own interval.
function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Locked";
  const totalMinutes = Math.floor(msRemaining / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function useCountdown(lockAt: string): string | null {
  const [label, setLabel] = React.useState<string | null>(null);
  React.useEffect(() => {
    const target = new Date(lockAt).getTime();
    if (Number.isNaN(target)) return;
    const tick = () => setLabel(formatCountdown(target - Date.now()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [lockAt]);
  return label;
}

type SaveState = "idle" | "saving" | "saved" | "error";

// Whether an in-progress answer counts toward the "N of M answered"
// progress indicator (doc 01 §2.4 step 2) — a question is "answered" once
// it has the one field its type actually needs, not merely "touched".
function isAnswered(type: QuestionResponse["type"], answer: PickAnswerInput): boolean {
  switch (type) {
    case "champion":
    case "runner_up":
    case "wooden_spoon":
      return Boolean(answer.teamId);
    case "top_n_unordered":
    case "top_n_ordered":
      return Boolean(answer.teamIds && answer.teamIds.length > 0);
    case "stat_leader":
      return Boolean(answer.playerId);
    case "numeric":
      return typeof answer.value === "number" && !Number.isNaN(answer.value);
    case "boolean":
    case "team_over_under":
      return typeof answer.bool === "boolean";
    case "custom":
      return Boolean(answer.optionId);
    default:
      return false;
  }
}

// Pick sheet (this session's brief, task 4): every question in the slate,
// one control per type, autosaving on change — no explicit Save button,
// just a debounced PUT per question (doc 01 §2.4 step 3: "Picks autosave on
// every change") and a small status indicator per row. Plain form elements,
// no visual design pass yet (docs/DECISIONS.md, session 14 deferred),
// matching src/routes/season-new.tsx's style.
export default function SeasonPicksPage() {
  const { groupId, seasonId } = useParams();
  const { status } = useSession();
  const user = useUser();

  const [season, setSeason] = React.useState<SeasonDetailResponse | null>(null);
  const [answers, setAnswers] = React.useState<Record<string, PickAnswerInput>>({});
  const [saveState, setSaveState] = React.useState<Record<string, SaveState>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isAdmin, setIsAdmin] = React.useState(false);

  // "Lock now" readiness flow (this session's brief): an admin can fetch a
  // completion summary and, from that same panel, force the lock early
  // instead of waiting for lock_at. `readiness === null` means the panel
  // hasn't been opened yet; toggling it closed again just discards the
  // fetched snapshot rather than tracking a separate "visible" boolean.
  const [readiness, setReadiness] = React.useState<ReadinessResponse | null>(null);
  const [readinessLoading, setReadinessLoading] = React.useState(false);
  const [locking, setLocking] = React.useState(false);

  const timers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const reloadSeason = React.useCallback(async () => {
    if (!seasonId) return;
    setSeason(await fetchSeasonDetail(seasonId));
  }, [seasonId]);

  React.useEffect(() => {
    if (status !== "signed-in" || !seasonId || !groupId) {
      return;
    }
    let cancelled = false;
    Promise.all([fetchSeasonDetail(seasonId), fetchMyPicks(seasonId), fetchGroupDetail(groupId)])
      .then(([detail, mine, group]) => {
        if (cancelled) return;
        setSeason(detail);
        setAnswers(Object.fromEntries(mine.picks.map((p) => [p.questionId, p.answer])));
        const membership = group.members.find((m) => m.userId === user?.id);
        setIsAdmin(membership?.role === "admin");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the slate");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, seasonId, groupId, user?.id]);

  // Cancel any pending debounced saves on unmount so they don't fire (and
  // call setState) after the page is gone.
  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
    };
  }, []);

  function scheduleSave(questionId: string, answer: PickAnswerInput) {
    if (!seasonId) return;
    const existingTimer = timers.current[questionId];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    setSaveState((prev) => ({ ...prev, [questionId]: "saving" }));
    timers.current[questionId] = setTimeout(() => {
      void putPicks(seasonId, { picks: [{ questionId, answer }] })
        .then(() => {
          setSaveState((prev) => ({ ...prev, [questionId]: "saved" }));
        })
        .catch(() => {
          setSaveState((prev) => ({ ...prev, [questionId]: "error" }));
        });
    }, 600);
  }

  function updateAnswer(questionId: string, patch: PickAnswerInput) {
    setAnswers((prev) => ({ ...prev, [questionId]: patch }));
    scheduleSave(questionId, patch);
  }

  async function handleCheckReadiness() {
    if (!seasonId) return;
    setReadinessLoading(true);
    try {
      setReadiness(await fetchReadiness(seasonId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load pick readiness", {
        action: { label: "Retry", onClick: () => void handleCheckReadiness() },
      });
    } finally {
      setReadinessLoading(false);
    }
  }

  // PATCH lockAt to right now — the very next lazy-lock check (this page's
  // own reload) flips the season to `locked` (src/lib/seasons/state.ts's
  // effectiveSeasonStatus), fully consistent with CLAUDE.md rule 3: nothing
  // here is a scheduled job, it's a deliberate synchronous admin action.
  async function handleLockNow() {
    if (!seasonId) return;
    setLocking(true);
    try {
      await updateSeason(seasonId, { lockAt: new Date().toISOString() });
      setReadiness(null);
      await reloadSeason();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not lock the season", {
        action: { label: "Retry", onClick: () => void handleLockNow() },
      });
    } finally {
      setLocking(false);
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
  if (error || !season) {
    return <p className="text-destructive p-4">{error ?? "Season not found"}</p>;
  }

  const answeredCount = season.questions.filter((q) =>
    isAnswered(q.type, answers[q.id] ?? {})
  ).length;
  const total = season.questions.length;
  const locked = season.season.status !== "open";
  const progressPct = total > 0 ? Math.round((answeredCount / total) * 100) : 0;
  const complete = answeredCount === total && total > 0;
  // "Lock now" (this session's brief): only the group admin, and only
  // before the season has already locked/settled/voided — once it's locked
  // there's nothing left to check readiness for.
  const canLockNow =
    isAdmin && (season.season.status === "draft" || season.season.status === "open");

  return (
    <main className="mx-auto flex max-w-lg flex-col pb-24">
      {/* Persistent progress indicator + lock countdown
          (docs/05-DESIGN-PROMPT.md §7), sticky so it stays visible while
          scrolling the question stack. */}
      <div className="bg-background/95 sticky top-0 z-10 flex flex-col gap-3 border-b px-4 pt-4 pb-3 backdrop-blur">
        <Link className="text-muted-foreground w-fit text-sm underline" to={`/groups/${groupId}`}>
          ← Back to group
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{season.season.name}</h1>
            <p className="text-muted-foreground text-sm">Your picks</p>
          </div>
          {!locked && <LockCountdown lockAt={season.season.lockAt} />}
        </div>
        {total > 0 && (
          <div className="flex items-center gap-3">
            <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  complete ? "bg-positive" : "bg-primary"
                )}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="font-score text-sm">
              {answeredCount}/{total}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4">
        {canLockNow && (
          <LockNowPanel
            readiness={readiness}
            loading={readinessLoading}
            locking={locking}
            onCheck={() => void handleCheckReadiness()}
            onCancel={() => setReadiness(null)}
            onConfirm={() => void handleLockNow()}
          />
        )}

        {locked && (
          <p className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-3 text-sm">
            This season is {season.season.status} — picks can no longer be changed.
          </p>
        )}

        {complete && !locked && (
          <p className="bg-positive/10 text-positive rounded-lg px-4 py-3 text-sm font-bold">
            Your slate is complete. Good luck.
          </p>
        )}

        {/* Empty state: a season an admin published without adding any
            questions yet (this hardening session's fix — doc 04's "a season
            with no questions" checklist item). Distinct from `locked`, which
            has its own message above. */}
        {total === 0 && !locked && (
          <p className="text-muted-foreground text-sm">
            This season doesn't have any questions yet. Check back once the admin adds some.
          </p>
        )}

        {season.questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            index={index}
            question={question}
            answer={answers[question.id] ?? {}}
            teams={season.teams}
            saveState={saveState[question.id] ?? "idle"}
            disabled={locked}
            onChange={(answer) => updateAnswer(question.id, answer)}
          />
        ))}
      </div>
    </main>
  );
}

function LockCountdown({ lockAt }: { lockAt: string }) {
  const label = useCountdown(lockAt);
  if (!label) return null;
  return (
    <div className="flex shrink-0 flex-col items-end">
      <span className="text-muted-foreground text-[10px] font-bold tracking-widest uppercase">
        Locks in
      </span>
      <span className="font-score text-lg">{label}</span>
    </div>
  );
}

interface LockNowPanelProps {
  readiness: ReadinessResponse | null;
  loading: boolean;
  locking: boolean;
  onCheck: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

// Admin-only "lock now" confirmation (this session's brief): a plain inline
// panel, not a modal — matches this codebase's existing toast-for-errors,
// inline-card-for-state pattern (e.g. the "slate is complete" banner above)
// rather than pulling in a dialog library. Readiness is information for the
// admin to act on, not a hard block — "Lock now" stays clickable even when
// members are missing picks, per the product owner's own framing ("if not
// tell me who needs to pick what... I will text them").
function LockNowPanel({ readiness, loading, locking, onCheck, onCancel, onConfirm }: LockNowPanelProps) {
  if (!readiness) {
    return (
      <div className="border-border bg-card flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <span className="text-sm font-medium">Ready to lock the season early?</span>
        <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onCheck}>
          {loading ? "Checking…" : "Check readiness"}
        </Button>
      </div>
    );
  }

  const incomplete = readiness.members.filter((m) => m.missingQuestions.length > 0);
  const allComplete = incomplete.length === 0;

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-lg border px-4 py-3">
      {allComplete ? (
        <p className="text-positive text-sm font-bold">Everyone's picks are in — lock the season now?</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {incomplete.length} of {readiness.members.length} member{readiness.members.length === 1 ? "" : "s"}{" "}
            still {incomplete.length === 1 ? "has" : "have"} picks missing:
          </p>
          <ul className="flex flex-col gap-1.5">
            {incomplete.map((m) => (
              <li key={m.memberId} className="text-sm">
                <span className="font-medium">{m.displayName}</span>{" "}
                <span className="text-muted-foreground">
                  is missing: {m.missingQuestions.map((q) => q.prompt).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={locking} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" variant="destructive" disabled={locking} onClick={onConfirm}>
          {locking ? "Locking…" : "Lock now"}
        </Button>
      </div>
    </div>
  );
}

// Every question type gets its own short eyebrow label — the "different
// answer-pattern treatments" the brief calls for (§7) start with naming the
// pattern, not just the control.
const TYPE_LABEL: Record<QuestionResponse["type"], string> = {
  champion: "Team pick",
  runner_up: "Team pick",
  wooden_spoon: "Team pick",
  top_n_unordered: "Multi-select",
  top_n_ordered: "Ranked pick",
  stat_leader: "Player pick",
  numeric: "Number",
  boolean: "Yes / no",
  team_over_under: "Yes / no",
  custom: "Multiple choice",
};

interface QuestionCardProps {
  index: number;
  question: QuestionResponse;
  answer: PickAnswerInput;
  teams: TeamSummary[];
  saveState: SaveState;
  disabled: boolean;
  onChange: (answer: PickAnswerInput) => void;
}

function QuestionCard({ index, question, answer, teams, saveState, disabled, onChange }: QuestionCardProps) {
  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-score text-muted-foreground text-sm">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <p className="text-accent-foreground text-[10px] font-bold tracking-widest uppercase">
              {TYPE_LABEL[question.type]}
            </p>
            <p className="text-sm leading-snug font-medium">{question.prompt}</p>
          </div>
        </div>
        <span className="bg-secondary text-secondary-foreground font-score shrink-0 rounded-full px-2.5 py-1 text-xs">
          {question.points} pts
        </span>
      </div>
      <QuestionInput question={question} answer={answer} teams={teams} disabled={disabled} onChange={onChange} />
      <SaveStatus state={saveState} />
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const text = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Could not save — try again";
  const className =
    state === "error" ? "text-destructive text-xs font-medium" : "text-muted-foreground text-xs";
  return <span className={className}>{text}</span>;
}

interface QuestionInputProps {
  question: QuestionResponse;
  answer: PickAnswerInput;
  teams: TeamSummary[];
  disabled: boolean;
  onChange: (answer: PickAnswerInput) => void;
}

// A team's label in every dropdown this file renders: full name plus its
// shortName/abbreviation ("Royal Challengers Bengaluru (RCB)") so an entry
// like the product owner's "RCB" is recognizable at a glance even though the
// stored value is always the real team.id (this session's bug fix — see the
// note on QuestionInput below).
function teamLabel(t: TeamSummary): string {
  return `${t.name} (${t.shortName})`;
}

// One team dropdown, backed by the season's real team catalogue
// (season.teams, from GET /api/seasons/:id — src/lib/seasons/service.ts's
// getSeasonTeams). `excludeIds` keeps a top-N slot's remaining options from
// re-offering a team already chosen in a sibling slot; the resolvers in
// src/lib/scoring/resolvers/top-n-*.ts still reject a duplicate server-side
// regardless, this just makes it hard to attempt one.
function TeamSelect({
  teams,
  value,
  excludeIds,
  placeholder,
  disabled,
  onChange,
}: {
  teams: TeamSummary[];
  value: string | undefined;
  excludeIds?: ReadonlySet<string>;
  placeholder: string;
  disabled: boolean;
  onChange: (teamId: string) => void;
}) {
  const options = excludeIds ? teams.filter((t) => !excludeIds.has(t.id) || t.id === value) : teams;
  return (
    <Select value={value ?? ""} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {teamLabel(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// One control per question type, each producing exactly the PickAnswer
// shape that type's resolver in src/lib/scoring/resolvers/*.ts validates
// (this session's brief, task 2). Team-referencing types (champion,
// runner_up, wooden_spoon, top_n_unordered, top_n_ordered) get a dropdown
// over the season's real team catalogue (season.teams) instead of a
// free-text box: a free-typed value like "RCB" is never a real team.id, so
// it always failed src/lib/picks/service.ts's per-resolver `validate()` call
// against Tournament.teamIds — this is that bug's fix. `stat_leader` stays
// free text on purpose: its resolver (src/lib/scoring/resolvers/stat-leader.ts)
// has no player-pool check at all (the comment there says the DB layer is
// responsible, and it isn't yet), so an unrecognized player name doesn't
// fail validation the way an unrecognized team does — a different, separate
// gap, not this bug, and out of scope here. `team_over_under`'s teamId is
// fixed by the admin in the question's config when it's created (doc 03
// §3.3), not chosen by the member — the member's answer here is just yes/no.
// IdentityBadge derives both colour and initials from whatever string it's
// given — passing a raw team.id (a hex createId(), e.g. "97318af0...")
// silently produced two DIGITS as the badge's "initials" (a hex string's
// first two characters are frequently digits), which is exactly the "random
// 2 digits" bug: badges must be seeded with the team's actual name/shortName,
// never its id.
function teamBadgeSeed(teamId: string, teams: TeamSummary[]): string {
  const team = teams.find((t) => t.id === teamId);
  return team ? team.shortName || team.name : teamId;
}

function QuestionInput({ question, answer, teams, disabled, onChange }: QuestionInputProps) {
  switch (question.type) {
    case "champion":
    case "runner_up":
    case "wooden_spoon":
      return (
        <div className="flex items-center gap-2">
          {answer.teamId && <IdentityBadge seed={teamBadgeSeed(answer.teamId, teams)} shape="square" />}
          <div className="flex-1">
            <TeamSelect
              teams={teams}
              value={answer.teamId}
              placeholder="Select a team"
              disabled={disabled}
              onChange={(teamId) => onChange({ teamId })}
            />
          </div>
        </div>
      );
    case "top_n_unordered":
    case "top_n_ordered": {
      const n = typeof question.config.n === "number" ? question.config.n : 0;
      const picked = answer.teamIds ?? [];
      const slots = Array.from({ length: n }, (_, i) => picked[i]);
      const excludeIds = new Set(picked.filter((id): id is string => Boolean(id)));

      function setSlot(i: number, teamId: string) {
        const next = [...slots];
        next[i] = teamId;
        onChange({ teamIds: next.filter((id): id is string => Boolean(id)) });
      }

      return (
        <div className="flex flex-col gap-2">
          {slots.map((teamId, i) => (
            <div key={i} className="flex items-center gap-2">
              {question.type === "top_n_ordered" && (
                <span className="font-score text-muted-foreground w-5 shrink-0 text-sm">{i + 1}.</span>
              )}
              {teamId && <IdentityBadge seed={teamBadgeSeed(teamId, teams)} size="sm" shape="square" />}
              <div className="flex-1">
                <TeamSelect
                  teams={teams}
                  value={teamId}
                  excludeIds={excludeIds}
                  placeholder={`Team ${i + 1}`}
                  disabled={disabled}
                  onChange={(nextTeamId) => setSlot(i, nextTeamId)}
                />
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "stat_leader":
      return (
        <input
          className={inputClass}
          placeholder="Player ID"
          value={answer.playerId ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ playerId: event.target.value })}
        />
      );
    case "numeric":
      return (
        <input
          type="number"
          className={cn(inputClass, "font-score")}
          value={answer.value ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange({ value: event.target.value === "" || Number.isNaN(parsed) ? undefined : parsed });
          }}
        />
      );
    case "boolean":
    case "team_over_under":
      return (
        <div className="grid grid-cols-2 gap-2">
          {(["true", "false"] as const).map((value) => {
            const selected = answer.bool === (value === "true");
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onChange({ bool: value === "true" })}
                className={cn(
                  "rounded-lg border py-2.5 text-sm font-bold transition-colors disabled:opacity-50",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card hover:bg-accent"
                )}
              >
                {value === "true" ? "Yes" : "No"}
              </button>
            );
          })}
        </div>
      );
    case "custom": {
      const options = customQuestionOptions(question.config.options);
      return (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const selected = answer.optionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onChange({ optionId: option.id })}
                className={cn(
                  "rounded-full border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card hover:bg-accent"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
}
