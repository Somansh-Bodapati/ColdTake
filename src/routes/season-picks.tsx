import * as React from "react";
import { Link, useParams } from "react-router";
import type { Route } from "./+types/season-picks";
import { useSession } from "@/lib/session/use-session";
import { fetchSeasonDetail } from "@/lib/seasons/client";
import { fetchMyPicks, putPicks } from "@/lib/picks/client";
import type { QuestionResponse, SeasonDetailResponse } from "@/lib/schemas/seasons";
import type { PickAnswerInput } from "@/lib/schemas/picks";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Your picks | ColdTake" }];
}

const inputClass = "border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs";

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

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4">
      <Link className="text-muted-foreground text-sm underline" to={`/groups/${groupId}`}>
        ← Back to group
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{season.season.name} — your picks</h1>
        <p className="text-muted-foreground text-sm">
          {answeredCount} of {total} answered
        </p>
      </div>

      {locked && (
        <p className="text-muted-foreground text-sm">
          This season is {season.season.status} — picks can no longer be changed.
        </p>
      )}

      {answeredCount === total && total > 0 && !locked && (
        <p className="text-sm font-medium">Your slate is complete. Good luck.</p>
      )}

      <div className="flex flex-col gap-4">
        {season.questions.map((question) => (
          <QuestionCard
            key={question.id}
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

interface QuestionCardProps {
  question: QuestionResponse;
  answer: PickAnswerInput;
  saveState: SaveState;
  disabled: boolean;
  onChange: (answer: PickAnswerInput) => void;
}

function QuestionCard({ question, answer, saveState, disabled, onChange }: QuestionCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{question.prompt}</p>
        <span className="text-muted-foreground text-xs">{question.points} pts</span>
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
    state === "error" ? "text-destructive text-xs" : "text-muted-foreground text-xs";
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
        <input
          className={inputClass}
          placeholder="Team ID"
          value={answer.teamId ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ teamId: event.target.value })}
        />
      );
    case "top_n_unordered":
    case "top_n_ordered":
      return (
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
          className={inputClass}
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
        <select
          className={inputClass}
          value={answer.bool === undefined ? "" : String(answer.bool)}
          disabled={disabled}
          onChange={(event) => onChange({ bool: event.target.value === "" ? undefined : event.target.value === "true" })}
        >
          <option value="">Choose…</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    case "custom": {
      const options = customOptions(question.config.options);
      return (
        <select
          className={inputClass}
          value={answer.optionId ?? ""}
          disabled={disabled}
          onChange={(event) => onChange({ optionId: event.target.value || undefined })}
        >
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    default:
      return null;
  }
}
