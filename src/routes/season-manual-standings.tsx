import * as React from "react";
import { Link, useParams } from "react-router";
import type { Route } from "./+types/season-manual-standings";
import { useSession, useUser } from "@/lib/session/use-session";
import { fetchSeasonDetail } from "@/lib/seasons/client";
import { fetchGroupDetail } from "@/lib/groups/client";
import { saveManualStandings } from "@/lib/providers/client";
import type { SeasonDetailResponse } from "@/lib/schemas/seasons";
import type { GroupDetailResponse } from "@/lib/schemas/groups";
import type { TeamStandingInput } from "@/lib/schemas/providers";
import { Button } from "@/components/ui/button";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Manual standings | ColdTake" }];
}

const inputClass = "border-input rounded-md border bg-transparent px-2 py-1 text-sm shadow-xs";

interface DraftRow {
  key: string;
  teamId: string;
  played: string;
  won: string;
  lost: string;
  points: string;
  nrr: string;
  position: string;
}

function emptyRow(index: number): DraftRow {
  return {
    key: `row-${index}-${Date.now()}`,
    teamId: "",
    played: "0",
    won: "0",
    lost: "0",
    points: "0",
    nrr: "0",
    position: String(index + 1),
  };
}

function parseRow(row: DraftRow): TeamStandingInput | null {
  if (row.teamId.trim().length === 0) {
    return null;
  }
  return {
    teamId: row.teamId.trim(),
    played: Number(row.played) || 0,
    won: Number(row.won) || 0,
    lost: Number(row.lost) || 0,
    points: Number(row.points) || 0,
    nrr: Number(row.nrr) || 0,
    position: Number(row.position) || 1,
  };
}

// Admin-facing league table + stat leader entry (this session's brief, task
// 3) — the only UI for getting data into ManualProvider
// (src/lib/providers/manual-provider.ts). Deliberately plain rows of typed
// team/player ids rather than pickers backed by a team catalogue API: no
// such endpoint exists yet (doc 03 §1.3's team table has no list route),
// and an admin typing the same ids they used when setting up the season's
// questions is enough for Week 1 (doc 02 §4.3).
export default function SeasonManualStandingsPage() {
  const { groupId, seasonId } = useParams();
  const user = useUser();
  const { status } = useSession();

  const [season, setSeason] = React.useState<SeasonDetailResponse | null>(null);
  const [group, setGroup] = React.useState<GroupDetailResponse | null>(null);
  const [rows, setRows] = React.useState<DraftRow[]>([emptyRow(0)]);
  const [statCategory, setStatCategory] = React.useState("runs");
  const [statEntries, setStatEntries] = React.useState<{ playerId: string; value: string }[]>([
    { playerId: "", value: "0" },
  ]);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (status !== "signed-in" || !seasonId || !groupId) {
      return;
    }
    let cancelled = false;
    Promise.all([fetchSeasonDetail(seasonId), fetchGroupDetail(groupId)])
      .then(([seasonDetail, groupDetail]) => {
        if (cancelled) return;
        setSeason(seasonDetail);
        setGroup(groupDetail);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load season");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, seasonId, groupId]);

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function handleSubmit() {
    if (!season) return;
    const tableData = rows.map(parseRow).filter((row): row is TeamStandingInput => row !== null);
    if (tableData.length === 0) {
      setError("Enter at least one team row");
      return;
    }

    const statLeaders =
      statCategory.trim().length === 0
        ? {}
        : {
            [statCategory.trim()]: statEntries
              .filter((entry) => entry.playerId.trim().length > 0)
              .map((entry) => ({ playerId: entry.playerId.trim(), value: Number(entry.value) || 0 })),
          };

    setSubmitting(true);
    setError(null);
    try {
      const result = await saveManualStandings(season.season.tournamentId, { tableData, statLeaders });
      setSavedAt(result.fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save manual standings");
    } finally {
      setSubmitting(false);
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
  if (error && !season) {
    return <p className="text-destructive p-4">{error}</p>;
  }
  if (!season || !group) {
    return <p className="text-destructive p-4">Season not found</p>;
  }

  const isAdmin = group.members.find((m) => m.userId === user?.id)?.role === "admin";
  if (!isAdmin) {
    return <p className="text-destructive p-4">Only a group admin can enter standings manually.</p>;
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <Link className="text-muted-foreground text-sm underline" to={`/groups/${groupId}/seasons/${seasonId}/standings`}>
        ← Back to standings
      </Link>
      <h1 className="text-2xl font-semibold">Manual standings — {season.season.name}</h1>
      <p className="text-muted-foreground text-sm">
        No live data provider is connected yet (docs/DECISIONS.md). Enter the current league table and stat
        leaders here; saving immediately recomputes standings for every season tracking this tournament.
      </p>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">League table</h2>
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-7 gap-1">
              <input
                className={inputClass}
                placeholder="Team id"
                value={row.teamId}
                onChange={(event) => updateRow(row.key, { teamId: event.target.value })}
              />
              <input
                className={inputClass}
                type="number"
                placeholder="Pld"
                value={row.played}
                onChange={(event) => updateRow(row.key, { played: event.target.value })}
              />
              <input
                className={inputClass}
                type="number"
                placeholder="Won"
                value={row.won}
                onChange={(event) => updateRow(row.key, { won: event.target.value })}
              />
              <input
                className={inputClass}
                type="number"
                placeholder="Lost"
                value={row.lost}
                onChange={(event) => updateRow(row.key, { lost: event.target.value })}
              />
              <input
                className={inputClass}
                type="number"
                placeholder="Pts"
                value={row.points}
                onChange={(event) => updateRow(row.key, { points: event.target.value })}
              />
              <input
                className={inputClass}
                type="number"
                step="0.001"
                placeholder="NRR"
                value={row.nrr}
                onChange={(event) => updateRow(row.key, { nrr: event.target.value })}
              />
              <input
                className={inputClass}
                type="number"
                placeholder="Pos"
                value={row.position}
                onChange={(event) => updateRow(row.key, { position: event.target.value })}
              />
            </div>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setRows((prev) => [...prev, emptyRow(prev.length)])}>
          + Team row
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Stat leaders</h2>
        <input
          className={inputClass}
          placeholder="Stat category (e.g. runs)"
          value={statCategory}
          onChange={(event) => setStatCategory(event.target.value)}
        />
        {statEntries.map((entry, index) => (
          <div key={index} className="grid grid-cols-2 gap-1">
            <input
              className={inputClass}
              placeholder="Player id"
              value={entry.playerId}
              onChange={(event) => {
                const next = [...statEntries];
                next[index] = { ...entry, playerId: event.target.value };
                setStatEntries(next);
              }}
            />
            <input
              className={inputClass}
              type="number"
              placeholder="Value"
              value={entry.value}
              onChange={(event) => {
                const next = [...statEntries];
                next[index] = { ...entry, value: event.target.value };
                setStatEntries(next);
              }}
            />
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setStatEntries((prev) => [...prev, { playerId: "", value: "0" }])}
        >
          + Player row
        </Button>
      </div>

      <Button type="button" disabled={submitting} onClick={() => void handleSubmit()}>
        {submitting ? "Saving…" : "Save and recompute standings"}
      </Button>

      {savedAt && (
        <p className="text-sm text-emerald-600">
          Saved. live_state refreshed at {new Date(savedAt).toLocaleString()}.
        </p>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </main>
  );
}
