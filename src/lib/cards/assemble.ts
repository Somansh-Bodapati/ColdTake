// DB -> card-data assembly (this session's brief: reveal/standings/swing/
// recap). Every function here returns { data, timestamp } — `timestamp` is
// the ISO instant the URL scheme's immutable path segment must equal (task
// 4: "the timestamp is fixed at generation time, not 'now' on every
// request"). Rather than minting a fresh timestamp per render, each card
// reuses an already-immutable domain timestamp it's built from — a
// standings_snapshot's own `computed_at`, a season's `lock_at`, or its
// `settled_at` — so the same underlying fact always maps to the same URL,
// and a new fact (a new snapshot, a new lock) always mints a new one. The
// api/cards/* routes are what actually enforce that: they re-derive this
// same timestamp and 404 if the URL's segment doesn't match it, rather than
// trusting the caller's claim.

import { eq } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import { team, type PickAnswer } from "../db/schema.js";
import { loadSeason, getQuestions } from "../seasons/service.js";
import { getGroupBranding } from "../groups/service.js";
import { getAllPicks } from "../picks/service.js";
import { getLatestSnapshot, getStandingsHistory, type StandingsSnapshotRow } from "../standings/service.js";
import { isRevealed } from "../seasons/state.js";
import { AppError } from "../errors.js";
import type {
  RecapCardCall,
  RecapCardData,
  RevealCardData,
  StandingsCardData,
  SwingCardData,
} from "./types.js";

async function loadBranding(db: Db, groupId: string): Promise<{ groupName: string }> {
  const branding = await getGroupBranding(db, groupId);
  return { groupName: branding.name };
}

function formatPickAnswer(
  answer: PickAnswer,
  teamNameById: ReadonlyMap<string, string>,
  optionLabelById: ReadonlyMap<string, string>
): string {
  if (answer.teamId) return teamNameById.get(answer.teamId) ?? answer.teamId;
  if (answer.teamIds && answer.teamIds.length > 0) {
    return answer.teamIds.map((id) => teamNameById.get(id) ?? id).join(", ");
  }
  if (answer.playerId) return answer.playerId;
  if (typeof answer.value === "number") return String(answer.value);
  if (typeof answer.bool === "boolean") return answer.bool ? "Yes" : "No";
  if (answer.optionId) return optionLabelById.get(answer.optionId) ?? answer.optionId;
  return "—";
}

export interface CardAssembly<T> {
  data: T;
  timestamp: string;
}

// GET /api/cards/reveal/:seasonId/:timestamp.png — "everyone's champion
// pick, at lock" (doc 01 §6.1). Highlights the season's `champion` question
// if it has one (sorted first by src/lib/seasons/service.ts's own
// question_season_id_sort_order_idx ordering among champion questions),
// falling back to the first question overall for a season with no champion
// question at all, rather than rendering an empty card.
export async function assembleRevealCard(
  db: Db,
  seasonId: string,
  now: Date
): Promise<CardAssembly<RevealCardData>> {
  const seasonRow = await loadSeason(db, seasonId, now);
  if (!isRevealed(seasonRow.status)) {
    throw new AppError(403, "Picks are not revealed until the season locks");
  }

  const [branding, questionRows] = await Promise.all([
    loadBranding(db, seasonRow.groupId),
    getQuestions(db, seasonId),
  ]);

  const highlightQuestion =
    questionRows.find((q) => q.type === "champion") ?? questionRows[0];
  if (!highlightQuestion) {
    throw new AppError(404, "This season has no questions to reveal");
  }

  const [teamRows, memberPicks] = await Promise.all([
    db.select({ id: team.id, name: team.name }).from(team).where(eq(team.tournamentId, seasonRow.tournamentId)),
    getAllPicks(db, seasonId, seasonRow.memberSnapshot ?? []),
  ]);
  const teamNameById = new Map(teamRows.map((row) => [row.id, row.name]));
  const optionLabelById = new Map(
    (highlightQuestion.config.options ?? []).map((option) => [option.id, option.label])
  );

  const picks = memberPicks
    .map((member) => {
      const answer = member.picks.find((p) => p.questionId === highlightQuestion.id)?.answer;
      return {
        displayName: member.displayName,
        answerLabel: answer ? formatPickAnswer(answer, teamNameById, optionLabelById) : "No pick",
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    data: {
      ...branding,
      seasonName: seasonRow.name,
      highlightPrompt: highlightQuestion.prompt,
      picks,
    },
    timestamp: seasonRow.lockAt.toISOString(),
  };
}

function toStandingsRows(snapshot: StandingsSnapshotRow): StandingsCardData["standings"] {
  return snapshot.standings
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => ({
      rank: entry.rank,
      displayName: entry.displayName,
      points: entry.points,
      delta: entry.delta,
    }));
}

// GET /api/cards/standings/:seasonId/:timestamp.png — "current leaderboard,
// weekly" (doc 01 §6.1). Reads standings_snapshot alone, same read
// discipline as api/seasons/[id]/standings/index.ts (CLAUDE.md rule 2: no
// computed join on a public GET).
export async function assembleStandingsCard(
  db: Db,
  seasonId: string,
  now: Date
): Promise<CardAssembly<StandingsCardData>> {
  const seasonRow = await loadSeason(db, seasonId, now);
  const snapshot = await getLatestSnapshot(db, seasonId);
  if (!snapshot) {
    throw new AppError(404, "No standings have been computed for this season yet");
  }

  const branding = await loadBranding(db, seasonRow.groupId);

  return {
    data: {
      ...branding,
      seasonName: seasonRow.name,
      isProjected: snapshot.isProjected,
      computedAt: snapshot.computedAt.toISOString(),
      standings: toStandingsRows(snapshot),
    },
    timestamp: snapshot.computedAt.toISOString(),
  };
}

// GET /api/cards/swing/:seasonId/:timestamp.png — "'Somansh jumped 4
// places' after a big result" (doc 01 §6.1). Compares the two most recent
// standings_snapshot rows (Session 9's history endpoint reads the same
// table) and highlights whichever member's rank moved the most between
// them; a points-delta tiebreak covers the (rare) case of two members
// swinging the same number of places.
export async function assembleSwingCard(
  db: Db,
  seasonId: string,
  now: Date
): Promise<CardAssembly<SwingCardData>> {
  const seasonRow = await loadSeason(db, seasonId, now);
  const history = await getStandingsHistory(db, seasonId); // newest first
  const [latest, previous] = history;
  if (!latest || !previous) {
    throw new AppError(404, "Not enough standings history yet to show a swing");
  }

  const previousByMember = new Map(previous.standings.map((entry) => [entry.memberId, entry]));

  let best: { memberId: string; displayName: string; fromRank: number; toRank: number; fromPoints: number; toPoints: number } | undefined;
  for (const entry of latest.standings) {
    const before = previousByMember.get(entry.memberId);
    if (!before) continue; // wasn't ranked in the prior snapshot yet
    const places = Math.abs(before.rank - entry.rank);
    const bestPlaces = best ? Math.abs(best.fromRank - best.toRank) : -1;
    const pointsDelta = entry.points - before.points;
    const bestPointsDelta = best ? best.toPoints - best.fromPoints : -1;
    if (places > bestPlaces || (places === bestPlaces && pointsDelta > bestPointsDelta)) {
      best = {
        memberId: entry.memberId,
        displayName: entry.displayName,
        fromRank: before.rank,
        toRank: entry.rank,
        fromPoints: before.points,
        toPoints: entry.points,
      };
    }
  }
  if (!best) {
    throw new AppError(404, "No member was ranked in both of the last two snapshots");
  }

  const branding = await loadBranding(db, seasonRow.groupId);

  return {
    data: {
      ...branding,
      seasonName: seasonRow.name,
      displayName: best.displayName,
      fromRank: best.fromRank,
      toRank: best.toRank,
      fromPoints: best.fromPoints,
      toPoints: best.toPoints,
      asOf: latest.computedAt.toISOString(),
    },
    timestamp: latest.computedAt.toISOString(),
  };
}

// GET /api/cards/recap/:seasonId/:timestamp.png — "final standings and the
// season's best and worst calls" (doc 01 §6.1). "Best/worst call" is read
// straight off the final snapshot's own per-question breakdown
// (src/lib/db/schema.ts's StandingsBreakdownEntry, already computed by
// Session 9's recomputeStandings) rather than recomputing anything: best is
// the single highest-scoring answer anyone gave on any question; worst is
// the single question where the awarded points fell shortest of what that
// question was worth. Both need `points > 0` on maxPossible — a
// question worth 0 points can't be anyone's best or worst call.
export async function assembleRecapCard(
  db: Db,
  seasonId: string,
  now: Date
): Promise<CardAssembly<RecapCardData>> {
  const seasonRow = await loadSeason(db, seasonId, now);
  if (seasonRow.status !== "settled") {
    throw new AppError(409, "This season hasn't been settled yet");
  }

  const [branding, snapshot, questionRows] = await Promise.all([
    loadBranding(db, seasonRow.groupId),
    getLatestSnapshot(db, seasonId),
    getQuestions(db, seasonId),
  ]);
  if (!snapshot) {
    throw new AppError(404, "No final standings have been computed for this season yet");
  }
  const promptByQuestionId = new Map(questionRows.map((q) => [q.id, q.prompt]));

  let best: { displayName: string; questionId: string; points: number; maxPossible: number } | undefined;
  let worst: { displayName: string; questionId: string; points: number; maxPossible: number } | undefined;
  for (const entry of snapshot.standings) {
    for (const item of entry.breakdown) {
      if (item.maxPossible <= 0) continue;
      if (!best || item.points > best.points) {
        best = { displayName: entry.displayName, questionId: item.questionId, points: item.points, maxPossible: item.maxPossible };
      }
      const missed = item.maxPossible - item.points;
      const worstMissed = worst ? worst.maxPossible - worst.points : -1;
      if (missed > worstMissed) {
        worst = { displayName: entry.displayName, questionId: item.questionId, points: item.points, maxPossible: item.maxPossible };
      }
    }
  }

  const toCall = (candidate: typeof best): RecapCardCall | undefined =>
    candidate
      ? {
          displayName: candidate.displayName,
          questionPrompt: promptByQuestionId.get(candidate.questionId) ?? "Question",
          points: candidate.points,
          maxPossible: candidate.maxPossible,
        }
      : undefined;

  return {
    data: {
      ...branding,
      seasonName: seasonRow.name,
      finalStandings: toStandingsRows(snapshot).map(({ rank, displayName, points }) => ({ rank, displayName, points })),
      bestCall: toCall(best),
      worstCall: toCall(worst),
    },
    timestamp: seasonRow.settledAt ? seasonRow.settledAt.toISOString() : snapshot.computedAt.toISOString(),
  };
}
