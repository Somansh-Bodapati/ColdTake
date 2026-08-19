import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Route } from "./+types/season-new";
import { useSession, useUser } from "@/lib/session/use-session";
import { fetchGroupDetail } from "@/lib/groups/client";
import {
  addQuestion,
  createSeason,
  deleteQuestion,
  fetchTournamentCatalogue,
  publishSeason,
} from "@/lib/seasons/client";
import { buildDefaultQuestionTemplates, type QuestionTemplate } from "@/lib/seasons/templates";
import type { QuestionInput, QuestionResponse, SeasonDetailResponse, TournamentSummary } from "@/lib/schemas/seasons";
import { Button } from "@/components/ui/button";

export function meta(_: Route.MetaArgs) {
  return [{ title: "New season | ColdTake" }];
}

const inputClass = "border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs";

interface DraftCustomQuestion {
  key: string;
  prompt: string;
  points: number;
  options: string[];
}

function toLocalDatetimeInputValue(iso: string): string {
  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Season creation flow (this session's brief, task 7): pick a tournament,
// review/edit the default question set (doc 01 §2.3 steps 1-2), add custom
// questions (task 4's builder), set the lock time, publish (step 6). Plain
// shadcn/native form elements, no visual design pass (docs/DECISIONS.md,
// session 14 deferred).
export default function SeasonNewPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const user = useUser();
  const { status } = useSession();

  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [tournaments, setTournaments] = React.useState<TournamentSummary[]>([]);
  const [tournamentId, setTournamentId] = React.useState<string>("");
  const [lockAt, setLockAt] = React.useState<string>("");
  const [templateChecks, setTemplateChecks] = React.useState<Record<string, boolean>>({});
  const [customQuestions, setCustomQuestions] = React.useState<DraftCustomQuestion[]>([]);
  const [newCustomPrompt, setNewCustomPrompt] = React.useState("");
  const [newCustomPoints, setNewCustomPoints] = React.useState(10);
  const [newCustomOptions, setNewCustomOptions] = React.useState(["", ""]);

  const [season, setSeason] = React.useState<SeasonDetailResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (status !== "signed-in" || !groupId || !user) {
      return;
    }
    let cancelled = false;
    Promise.all([fetchGroupDetail(groupId), fetchTournamentCatalogue()])
      .then(([group, catalogue]) => {
        if (cancelled) return;
        const membership = group.members.find((m) => m.userId === user.id);
        setIsAdmin(membership?.role === "admin");
        setTournaments(catalogue);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load setup data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, groupId, user]);

  const selectedTournament = tournaments.find((t) => t.id === tournamentId) ?? null;
  const templates: QuestionTemplate[] = React.useMemo(
    () => (selectedTournament ? buildDefaultQuestionTemplates(selectedTournament) : []),
    [selectedTournament]
  );

  function handleSelectTournament(id: string) {
    setTournamentId(id);
    const tournament = tournaments.find((t) => t.id === id);
    if (tournament) {
      setLockAt(toLocalDatetimeInputValue(tournament.startsAt));
      const nextTemplates = buildDefaultQuestionTemplates(tournament);
      setTemplateChecks(Object.fromEntries(nextTemplates.map((t) => [t.key, t.preChecked])));
    }
  }

  function handleAddCustomQuestion() {
    const options = newCustomOptions.map((o) => o.trim()).filter((o) => o.length > 0);
    if (newCustomPrompt.trim().length === 0 || options.length < 2) {
      setError("A custom question needs a prompt and at least 2 non-empty options");
      return;
    }
    setError(null);
    setCustomQuestions((prev) => [
      ...prev,
      {
        key: `custom-${prev.length}-${Date.now()}`,
        prompt: newCustomPrompt.trim(),
        points: newCustomPoints,
        options,
      },
    ]);
    setNewCustomPrompt("");
    setNewCustomPoints(10);
    setNewCustomOptions(["", ""]);
  }

  function draftQuestionInputs(): QuestionInput[] {
    const fromTemplates: QuestionInput[] = templates
      .filter((t) => templateChecks[t.key])
      .map((t) => ({ type: t.type, prompt: t.prompt, config: t.config, points: t.points, settlement: t.settlement }) as QuestionInput);

    const fromCustom: QuestionInput[] = customQuestions.map((c) => ({
      type: "custom",
      prompt: c.prompt,
      points: c.points,
      settlement: "manual",
      config: { options: c.options.map((label, i) => ({ id: `option-${i}`, label })) },
    }));

    return [...fromTemplates, ...fromCustom];
  }

  async function handleCreateSeason() {
    if (!groupId || !tournamentId || !lockAt) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createSeason({
        groupId,
        tournamentId,
        lockAt: new Date(lockAt).toISOString(),
        questions: draftQuestionInputs(),
      });
      setSeason(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the season");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddQuestionToDraft() {
    if (!season) return;
    const options = newCustomOptions.map((o) => o.trim()).filter((o) => o.length > 0);
    if (newCustomPrompt.trim().length === 0 || options.length < 2) {
      setError("A custom question needs a prompt and at least 2 non-empty options");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const inserted: QuestionResponse = await addQuestion(season.season.id, {
        type: "custom",
        prompt: newCustomPrompt.trim(),
        points: newCustomPoints,
        settlement: "manual",
        config: { options: options.map((label, i) => ({ id: `option-${i}`, label })) },
      });
      setSeason({ ...season, questions: [...season.questions, inserted] });
      setNewCustomPrompt("");
      setNewCustomPoints(10);
      setNewCustomOptions(["", ""]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the question");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveQuestion(questionId: string) {
    if (!season) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteQuestion(season.season.id, questionId);
      setSeason({ ...season, questions: season.questions.filter((q) => q.id !== questionId) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the question");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish() {
    if (!season || !groupId) return;
    setSubmitting(true);
    setError(null);
    try {
      const published = await publishSeason(season.season.id);
      setSeason({ ...season, season: published.season });
      navigate(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish the season");
    } finally {
      setSubmitting(false);
    }
  }

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
  if (isAdmin === false) {
    return <p className="text-destructive p-4">Only a group admin can set up a season.</p>;
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4">
      <Link className="text-muted-foreground text-sm underline" to={`/groups/${groupId}`}>
        ← Back to group
      </Link>
      <h1 className="text-2xl font-semibold">New season</h1>

      {!season && (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor="tournament" className="text-sm font-medium">
              1. Tournament
            </label>
            <select
              id="tournament"
              className={inputClass}
              value={tournamentId}
              onChange={(event) => handleSelectTournament(event.target.value)}
            >
              <option value="">Select a tournament…</option>
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.shortName}
                </option>
              ))}
            </select>
          </div>

          {selectedTournament && (
            <>
              <div className="flex flex-col gap-2">
                <label htmlFor="lockAt" className="text-sm font-medium">
                  2. Lock time
                </label>
                <input
                  id="lockAt"
                  type="datetime-local"
                  className={inputClass}
                  value={lockAt}
                  onChange={(event) => setLockAt(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">3. Question set — defaults pre-checked</h2>
                <ul className="flex flex-col gap-1">
                  {templates.map((t) => (
                    <li key={t.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        id={`template-${t.key}`}
                        checked={templateChecks[t.key] ?? false}
                        onChange={(event) =>
                          setTemplateChecks((prev) => ({ ...prev, [t.key]: event.target.checked }))
                        }
                      />
                      <label htmlFor={`template-${t.key}`} className="flex-1">
                        {t.prompt}
                      </label>
                      <span className="text-muted-foreground text-xs">{t.points} pts</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">4. Custom questions (optional)</h2>
                <CustomQuestionBuilder
                  prompt={newCustomPrompt}
                  points={newCustomPoints}
                  options={newCustomOptions}
                  onPromptChange={setNewCustomPrompt}
                  onPointsChange={setNewCustomPoints}
                  onOptionsChange={setNewCustomOptions}
                  onAdd={handleAddCustomQuestion}
                />
                {customQuestions.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {customQuestions.map((c) => (
                      <li key={c.key} className="flex items-center justify-between text-sm">
                        <span>
                          {c.prompt} <span className="text-muted-foreground text-xs">({c.options.join(", ")})</span>
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setCustomQuestions((prev) => prev.filter((q) => q.key !== c.key))}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Button type="button" disabled={submitting || !lockAt} onClick={() => void handleCreateSeason()}>
                {submitting ? "Creating…" : "Create season (draft)"}
              </Button>
            </>
          )}
        </>
      )}

      {season && (
        <div className="flex flex-col gap-4">
          <p>
            Draft season for <strong>{season.season.name}</strong> — status:{" "}
            <strong>{season.season.status}</strong>
          </p>

          <div>
            <h2 className="mb-2 text-sm font-medium">Questions ({season.questions.length})</h2>
            <ul className="flex flex-col gap-1">
              {season.questions.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {q.prompt} <span className="text-muted-foreground text-xs">({q.type}, {q.points} pts)</span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => void handleRemoveQuestion(q.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Add another custom question</h2>
            <CustomQuestionBuilder
              prompt={newCustomPrompt}
              points={newCustomPoints}
              options={newCustomOptions}
              onPromptChange={setNewCustomPrompt}
              onPointsChange={setNewCustomPoints}
              onOptionsChange={setNewCustomOptions}
              onAdd={() => void handleAddQuestionToDraft()}
            />
          </div>

          <Button
            type="button"
            disabled={submitting || season.questions.length === 0}
            onClick={() => void handlePublish()}
          >
            {submitting ? "Publishing…" : "Publish season"}
          </Button>
        </div>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}
    </main>
  );
}

interface CustomQuestionBuilderProps {
  prompt: string;
  points: number;
  options: string[];
  onPromptChange: (value: string) => void;
  onPointsChange: (value: number) => void;
  onOptionsChange: (value: string[]) => void;
  onAdd: () => void;
}

// The custom question builder itself (this session's brief, task 4): free
// text prompt + a growable list of admin-defined options — the escape hatch
// doc 01 §3 calls "the fallback that makes the whole thing robust." Shared
// between the pre-creation flow and "add another question to an existing
// draft" since both ultimately produce the same `{type: "custom", config:
// {options}}` shape.
function CustomQuestionBuilder({
  prompt,
  points,
  options,
  onPromptChange,
  onPointsChange,
  onOptionsChange,
  onAdd,
}: CustomQuestionBuilderProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <input
        className={inputClass}
        placeholder="Question prompt (e.g. 'Who wears the funniest hat?')"
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
      />
      <div className="flex flex-col gap-1">
        {options.map((option, index) => (
          <input
            key={index}
            className={inputClass}
            placeholder={`Option ${index + 1}`}
            value={option}
            onChange={(event) => {
              const next = [...options];
              next[index] = event.target.value;
              onOptionsChange(next);
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onOptionsChange([...options, ""])}>
          + Option
        </Button>
        <label className="flex items-center gap-1 text-sm">
          Points
          <input
            type="number"
            className={`${inputClass} w-20`}
            value={points}
            min={1}
            onChange={(event) => onPointsChange(Number(event.target.value) || 1)}
          />
        </label>
      </div>
      <Button type="button" size="sm" onClick={onAdd}>
        Add custom question
      </Button>
    </div>
  );
}
