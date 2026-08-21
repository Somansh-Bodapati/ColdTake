import * as React from "react";
import { Link, useParams } from "react-router";
import type { Route } from "./+types/season-picks";
import { useSession } from "@/lib/session/use-session";
import { fetchSeasonDetail } from "@/lib/seasons/client";
import { fetchMyPicks, putPicks } from "@/lib/picks/client";
import type { QuestionResponse, SeasonDetailResponse } from "@/lib/schemas/seasons";
import type { PickAnswerInput } from "@/lib/schemas/picks";
import { IdentityBadge } from "@/components/identity-badge";
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

  const [season, setSeason] = React.useState<SeasonDetailResponse | null>(null);
  const [answers, setAnswers] = React.useState<Record<string, PickAnswerInput>>({});
  const [saveState, setSaveState] = React.useState<Record<string, SaveState>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const timers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  React.useEffect(() => {
    if (status !== "signed-in" || !seasonId) {
      return;
    }
    let cancelled = false;
    Promise.all([fetchSeasonDetail(seasonId), fetchMyPicks(seasonId)])
      .then(([detail, mine]) => {
        if (cancelled) return;
        setSeason(detail);
        setAnswers(Object.fromEntries(mine.picks.map((p) => [p.questionId, p.answer])));
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
  }, [status, seasonId]);

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
  saveState: SaveState;
  disabled: boolean;
  onChange: (answer: PickAnswerInput) => void;
}

function QuestionCard({ index, question, answer, saveState, disabled, onChange }: QuestionCardProps) {
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
      <QuestionInput question={question} answer={answer} disabled={disabled} onChange={onChange} />
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
  disabled: boolean;
  onChange: (answer: PickAnswerInput) => void;
}

interface CustomOption {
  id: string;
  label: string;
}

// question.config is typed as z.record(z.string(), z.unknown()) at the API
// boundary (src/lib/schemas/seasons.ts's questionResponseSchema) since its
// shape depends on question.type — this narrows just the `custom` case back
// to the { id, label }[] shape src/lib/scoring/resolvers/custom.ts requires.
function customOptions(value: unknown): CustomOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is CustomOption =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === "string" &&
      typeof (entry as { label?: unknown }).label === "string"
  );
}

// One control per question type, each producing exactly the PickAnswer
// shape that type's resolver in src/lib/scoring/resolvers/*.ts validates
// (this session's brief, task 2) — a free-text team/player ID rather than a
// picker backed by a team/player catalogue, since no such catalogue is
// exposed to the client by any endpoint yet (out of scope for this
// session's API surface, doc 03 §3.4).
function QuestionInput({ question, answer, disabled, onChange }: QuestionInputProps) {
  switch (question.type) {
    case "champion":
    case "runner_up":
    case "wooden_spoon":
      return (
        <div className="flex items-center gap-2">
          {answer.teamId && <IdentityBadge seed={answer.teamId} shape="square" />}
          <input
            className={cn(inputClass, "flex-1")}
            placeholder="Team ID"
            value={answer.teamId ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ teamId: event.target.value })}
          />
        </div>
      );
    case "top_n_unordered":
    case "top_n_ordered":
      return (
        <div className="flex flex-col gap-2">
          <input
            className={inputClass}
            placeholder={question.type === "top_n_ordered" ? "Team IDs, in order, comma-separated" : "Team IDs, comma-separated"}
            value={(answer.teamIds ?? []).join(", ")}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                teamIds: event.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter((v) => v.length > 0),
              })
            }
          />
          {(answer.teamIds ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {(answer.teamIds ?? []).map((teamId, i) => (
                <span
                  key={`${teamId}-${i}`}
                  className="bg-secondary flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1.5 text-xs font-medium"
                >
                  <IdentityBadge seed={teamId} size="sm" shape="square" />
                  {question.type === "top_n_ordered" && (
                    <span className="font-score text-muted-foreground">{i + 1}.</span>
                  )}
                  {teamId}
                </span>
              ))}
            </div>
          )}
        </div>
      );
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
      const options = customOptions(question.config.options);
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
