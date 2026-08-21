import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Route } from "./+types/tournament-new";
import { useSession } from "@/lib/session/use-session";
import { createTournamentFromSeries, searchCricketDataSeries } from "@/lib/providers/client";
import type { CricketDataSeriesSummary } from "@/lib/schemas/providers";
import { Button } from "@/components/ui/button";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Add a tournament | ColdTake" }];
}

const inputClass = "border-input rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs";

// Admin-only tournament-creation flow (this session's brief): search
// CricketData.org for a real series, pick one, and create the `tournament`
// + `team` rows from it — the one missing piece before a group can set up a
// season against real cricket data instead of the seeded catalogue. Plain
// form UI, same style as season-new.tsx (no design-system pass applied to
// that flow yet either), not a one-off styled screen.
export default function TournamentNewPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { status } = useSession();

  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState<CricketDataSeriesSummary[]>([]);
  const [searched, setSearched] = React.useState(false);
  const [creatingId, setCreatingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) {
      setError("Search query must be at least 2 characters");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const series = await searchCricketDataSeries(query.trim());
      setResults(series);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not search CricketData");
    } finally {
      setSearching(false);
    }
  }

  async function handleCreate(series: CricketDataSeriesSummary) {
    setCreatingId(series.id);
    setError(null);
    try {
      const created = await createTournamentFromSeries({ seriesId: series.id, seriesName: series.name });
      // Hands the new tournament straight to season setup, same page every
      // other "pick a tournament" flow lands on — season-new.tsx preselects
      // it from this query param.
      navigate(`/groups/${groupId}/seasons/new?tournamentId=${encodeURIComponent(created.tournament.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the tournament");
      setCreatingId(null);
    }
  }

  if (!groupId) {
    return <p className="p-4">Missing group id.</p>;
  }
  if (status === "loading") {
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

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4">
      <Link className="text-muted-foreground text-sm underline" to={`/groups/${groupId}/seasons/new`}>
        ← Back to season setup
      </Link>
      <h1 className="text-2xl font-semibold">Add a real tournament</h1>
      <p className="text-muted-foreground text-sm">
        Search CricketData.org for a real series, then pick one to create it here — its teams are pulled in
        automatically.
      </p>

      <form className="flex gap-2" onSubmit={(event) => void handleSearch(event)}>
        <input
          className={`${inputClass} flex-1`}
          placeholder="e.g. Indian Premier League 2026"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit" disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {searched && !searching && results.length === 0 && !error && (
        <p className="text-muted-foreground text-sm">No series matched that search. Try a different name.</p>
      )}

      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((series) => (
            <li key={series.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">{series.name}</p>
                {(series.startDate || series.endDate) && (
                  <p className="text-muted-foreground text-xs">
                    {series.startDate ?? "?"} – {series.endDate ?? "?"}
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                disabled={creatingId !== null}
                onClick={() => void handleCreate(series)}
              >
                {creatingId === series.id ? "Creating…" : "Use this series"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
