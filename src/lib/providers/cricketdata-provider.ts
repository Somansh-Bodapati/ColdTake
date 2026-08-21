// CricketDataProvider — the second StandingsProvider implementation (doc 02
// §4.3: "Implementations: ManualProvider ... CricketDataProvider, and later
// others"). Session 11 built this against a *guessed* response shape (no
// vendor account existed yet). This session replaces it entirely against the
// real, verified shape of api.cricapi.com v1, captured live tonight with a
// real key against a real series — see cricketdata-dto.ts's header and
// docs/DECISIONS.md for the captured evidence.
//
// Same three-method contract as ManualProvider (manual-provider.ts) — no
// change to StandingsProvider itself. A tournament's CricketData series id
// comes from `tournament.providerKey` (schema.ts), set once by an admin.
//
// Rate-limit reality (docs/DECISIONS.md): the free tier is 100 requests/day,
// shared across every tournament this app ingests. That drives two design
// choices below:
//   1. getTable calls `series_info` exactly ONCE per invocation — that
//      single call embeds the series' full match list, so there is never a
//      per-match `match_info` call for routine table computation.
//   2. Every successful request logs a console.warn once usage crosses 80%
//      of the account's daily limit (`warnIfNearLimit`), using the `info`
//      block the API itself returns — no separate persisted rate tracker is
//      needed, since the API already reports its own usage.
//
// Two permanent (not temporary) gaps, both by design, both documented at
// their methods below:
//   - getStatLeaders always returns [] — this tier has no player-level
//     batting/bowling data anywhere.
//   - getFinalResult always throws ProviderUnsupportedError — a true
//     tournament "champion" isn't reliably derivable from raw match data.
//     Session 12's manual settlement + admin-override flow
//     (src/lib/seasons/settlement.ts) is the intended path for these.
// ProviderUnsupportedError is deliberately a different class from
// ProviderFetchError: it signals "this tier permanently doesn't support
// this," not "this call failed and might work next time," so callers
// (src/lib/providers/ingest.ts, src/lib/seasons/settlement.ts) don't treat
// it as a reason to fall back to stale data or retry.
//
// Every test exercising this class injects `fetchImpl` and feeds it fixture
// JSON from __fixtures__/ — never global fetch, never a real network call.

import { eq } from "drizzle-orm";
import type { Db } from "../auth/session.js";
import { team, tournament } from "../db/schema.js";
import {
  cricketDataSeriesInfoResponseSchema,
  type CricketDataInfo,
  type CricketDataMatchListEntry,
  type CricketDataSeriesInfoResponse,
} from "./cricketdata-dto.js";
import {
  ProviderUnsupportedError,
  type PlayerStat,
  type StandingsProvider,
  type TeamStanding,
  type TournamentResult,
} from "./types.js";
import { teamStandingSchema } from "../schemas/providers.js";
import type { ZodType } from "zod";

// Matches the global `fetch` signature closely enough to inject a fake in
// tests without pulling in a mocking library — same spirit as
// src/lib/providers/ingest-auth.ts's default-export-for-spying trick, but
// simpler since this is a constructor parameter, not a module import.
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// Transient failure: timeout, malformed JSON, an explicit "failure" envelope,
// or a response that fails schema validation. Retrying later might succeed.
export class ProviderFetchError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ProviderFetchError";
  }
}

export interface CricketDataProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.cricapi.com/v1";
const DEFAULT_TIMEOUT_MS = 8000;

// The free tier's hard daily cap (docs/DECISIONS.md) — used only to decide
// when warnIfNearLimit should fire; the API's own `info.hitsLimit` is used
// preferentially when present, this is just the fallback if it's ever absent.
const KNOWN_DAILY_LIMIT = 100;
const WARN_USAGE_RATIO = 0.8;

interface TeamAggregate {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  points: number;
}

export class CricketDataProvider implements StandingsProvider {
  readonly source = "cricketdata";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    private readonly db: Db,
    options: CricketDataProviderOptions
  ) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getTable(tournamentId: string): Promise<TeamStanding[]> {
    const seriesId = await this.seriesId(tournamentId);
    const response = await this.request<CricketDataSeriesInfoResponse>(
      "/series_info",
      { apikey: this.apiKey, offset: "0", id: seriesId },
      cricketDataSeriesInfoResponseSchema
    );
    this.warnIfNearLimit(response.info, "series_info");

    const matches = response.data?.matchList ?? [];
    const byName = await this.loadTeamNames(tournamentId);

    const aggregates = new Map<string, TeamAggregate>();
    const ensure = (teamId: string): TeamAggregate => {
      const existing = aggregates.get(teamId);
      if (existing) return existing;
      const created: TeamAggregate = { teamId, played: 0, won: 0, lost: 0, points: 0 };
      aggregates.set(teamId, created);
      return created;
    };

    for (const match of matches) {
      // Only a finished match has a decidable outcome — an in-progress
      // match's `status` (e.g. "Day 2: Stumps - England lead by 195 runs")
      // describes a moment, not a result, and an upcoming match's status is
      // just its scheduled time. Both are excluded from the table.
      if (!match.matchEnded) continue;

      const participants = this.resolveParticipants(match, byName, tournamentId);
      if (participants.size === 0) continue;

      const winnerTeamId = this.resolveWinner(match, participants);

      for (const teamId of participants.values()) {
        const agg = ensure(teamId);
        agg.played += 1;
        if (!winnerTeamId) {
          // matchEnded but no team name found in `status`: a tie, no-result,
          // or abandoned match (real documented status values: "Match tied",
          // "No result", "Match abandoned without a ball bowled") — standard
          // T20/ODI league scoring, 1 point each rather than a win/loss.
          agg.points += 1;
        } else if (teamId === winnerTeamId) {
          agg.won += 1;
          agg.points += 2;
        } else {
          agg.lost += 1;
        }
      }
    }

    const mapped: TeamStanding[] = [...aggregates.values()]
      .sort((a, b) => b.points - a.points || b.won - a.won)
      .map((agg, index) => ({
        teamId: agg.teamId,
        played: agg.played,
        won: agg.won,
        lost: agg.lost,
        points: agg.points,
        // Net run rate is not computable from series_info's matchList — it
        // carries only a human-readable `status` string per match, no
        // innings-level runs/overs data (that only exists on the per-match
        // match_info endpoint, which this provider deliberately doesn't call
        // per match — see this file's header). Reported as 0, not omitted,
        // so the shape still satisfies TeamStanding; this is a known,
        // permanent limitation of this provider tier, not a bug.
        nrr: 0,
        position: index + 1,
      }));

    return this.validateMapped(teamStandingSchema.array(), mapped, "table data");
  }

  // This tier of api.cricapi.com exposes no player-level batting/bowling
  // stats anywhere — a real completed match's match_info `score` field is
  // confirmed innings-level only (runs/wickets/overs), not per-player.
  // Stat-leader questions (Orange Cap/Purple Cap style) are therefore a
  // permanent gap for this provider, not a TODO.
  //
  // Returning [] here (rather than throwing) is the least-change fit for
  // both callers of this method: ingestTournament's per-category loop
  // (src/lib/providers/ingest.ts) and settleSeason's identical loop
  // (src/lib/seasons/settlement.ts) already treat an empty array as "nothing
  // to report for this category" and skip it silently — no fallback to
  // stale live_state, no thrown error to catch, and no error-log spam on
  // every 3-hourly cron run for a condition that will never change.
  // Tournaments configured with this provider shouldn't set
  // `config.statCategories` expecting them to populate; use ManualProvider
  // or the manual-standings admin entry for stat_leader questions instead.
  async getStatLeaders(_tournamentId: string, _category: string): Promise<PlayerStat[]> {
    return [];
  }

  // Determining a tournament's true "champion" from raw match data would
  // require reliably telling a final/playoff match apart from an ordinary
  // league match. series_info's matchList gives no such signal: `matchType`
  // is a format ("test"/"odi"/"t20"), not a stage, and a match `name`
  // occasionally saying "Final" is a naming-convention coincidence for
  // bilateral series, not something safe to parse and trust for real
  // tournament settlement (a knockout tournament's actual final is exactly
  // the case this would get wrong). This provider deliberately does not
  // attempt it, in either direction (guessing a winner or guessing "no
  // final yet").
  //
  // Throwing ProviderUnsupportedError here (rather than ever returning `{}`
  // silently) makes this a visible, typed signal rather than a
  // quietly-wrong empty result. src/lib/seasons/settlement.ts's settleSeason
  // — the only caller of this method — catches exactly this error type and
  // proceeds to write the final table without a final_result row, letting
  // Session 12's manual settlement + admin-override flow
  // (settleSeason's sibling settleQuestion) supply champion/runner-up
  // manually. This is a permanent, intentional scope boundary, not a gap.
  async getFinalResult(tournamentId: string): Promise<TournamentResult> {
    throw new ProviderUnsupportedError(
      `CricketDataProvider cannot determine a tournament's final result automatically (tournament ${tournamentId}); settle champion/runner-up manually`
    );
  }

  private resolveParticipants(
    match: CricketDataMatchListEntry,
    byName: Map<string, string>,
    tournamentId: string
  ): Map<string, string> {
    const participants = new Map<string, string>(); // provider-side team name -> our teamId
    for (const name of match.teams) {
      const teamId = byName.get(name.trim().toLowerCase());
      if (teamId) {
        participants.set(name, teamId);
      } else {
        console.warn(
          `CricketDataProvider: no team mapping for "${name}" in match "${match.id}" on tournament ${tournamentId}, excluding it from that match's table contribution`
        );
      }
    }
    return participants;
  }

  // Verified real behavior (docs/DECISIONS.md): a completed match's `status`
  // is a human-readable sentence like "Pakistan won by 7 wkts", with the
  // winning team's name appearing in possibly different case than in
  // `teams` — always match case-insensitively, never assume exact case.
  private resolveWinner(match: CricketDataMatchListEntry, participants: Map<string, string>): string | undefined {
    const status = match.status.toLowerCase();
    for (const [name, teamId] of participants) {
      if (status.includes(name.trim().toLowerCase())) {
        return teamId;
      }
    }
    return undefined;
  }

  private warnIfNearLimit(info: CricketDataInfo | undefined, path: string): void {
    const hitsToday = info?.hitsToday;
    const hitsLimit = info?.hitsLimit ?? KNOWN_DAILY_LIMIT;
    if (hitsToday === undefined || hitsLimit <= 0) return;

    const usage = hitsToday / hitsLimit;
    if (usage >= WARN_USAGE_RATIO) {
      console.warn(
        `CricketDataProvider: daily API usage at ${hitsToday}/${hitsLimit} hits (${Math.round(usage * 100)}%) after calling ${path} — approaching the free-tier daily limit`
      );
    }
  }

  private validateMapped<T>(schema: ZodType<T>, mapped: unknown, label: string): T {
    const validated = schema.safeParse(mapped);
    if (!validated.success) {
      throw new ProviderFetchError(`CricketData mapped ${label} failed validation: ${validated.error.message}`);
    }
    return validated.data;
  }

  private async seriesId(tournamentId: string): Promise<string> {
    const [row] = await this.db
      .select({ providerKey: tournament.providerKey })
      .from(tournament)
      .where(eq(tournament.id, tournamentId))
      .limit(1);
    if (!row?.providerKey) {
      throw new ProviderFetchError(
        `Tournament ${tournamentId} has no providerKey configured — CricketDataProvider needs it as the CricketData.org series id`
      );
    }
    return row.providerKey;
  }

  private async loadTeamNames(tournamentId: string): Promise<Map<string, string>> {
    const rows = await this.db.select().from(team).where(eq(team.tournamentId, tournamentId));
    const byName = new Map<string, string>();
    for (const row of rows) {
      byName.set(row.name.toLowerCase(), row.id);
      byName.set(row.shortName.toLowerCase(), row.id);
    }
    return byName;
  }

  private async request<T>(path: string, params: Record<string, string>, schema: ZodType<T>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), { signal: controller.signal });
    } catch (error) {
      throw new ProviderFetchError(`CricketData request to ${path} failed or timed out`, error);
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      throw new ProviderFetchError(`CricketData request to ${path} returned HTTP ${response.status}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new ProviderFetchError(`CricketData response from ${path} was not valid JSON`, error);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderFetchError(`CricketData response from ${path} did not match the expected shape: ${parsed.error.message}`);
    }

    const data = parsed.data as { status?: string; reason?: string };
    if (data.status === "failure") {
      throw new ProviderFetchError(`CricketData reported failure for ${path}: ${data.reason ?? "unknown reason"}`);
    }

    return parsed.data;
  }
}
