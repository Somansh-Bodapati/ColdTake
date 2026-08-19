// CricketDataProvider — the second StandingsProvider implementation (doc 02
// §4.3: "Implementations: ManualProvider ... CricketDataProvider, and later
// others"), modeled on CricketData.org's response envelope
// (cricketdata-dto.ts). docs/DECISIONS.md: no vendor account exists yet, so
// this is a best-effort mapping; see cricketdata-dto.ts's header for exactly
// which parts are verified vs. assumed.
//
// Same three-method contract as ManualProvider (manual-provider.ts) — no
// change to StandingsProvider itself. Where ManualProvider reads a row an
// admin typed in, this provider fetches from CricketData.org and translates
// their team/player ids into ours via `team.providerKey` / `player.providerKey`
// (schema.ts), falling back to a case-insensitive name match when a raw row
// carries no id — free-tier responses aren't guaranteed to include one.
//
// Failure handling (this session's brief, task 3): every failure mode
// (timeout, malformed JSON, a "failure" envelope, a response that fails
// schema validation) is normalized into a single ProviderFetchError thrown
// out of getTable/getStatLeaders/getFinalResult. This class does not itself
// catch that error or fall back to old data — src/lib/providers/ingest.ts is
// the one place that catches a provider failure and keeps serving the last
// good live_state, so that policy isn't duplicated per provider
// implementation.
//
// Every test exercising this class injects `fetchImpl` and feeds it fixture
// JSON from __fixtures__/ — never global fetch, never a real network call.

import { eq } from "drizzle-orm";
import type { Db } from "@/lib/auth/session";
import { player, team, tournament } from "@/lib/db/schema";
import {
  cricketDataSeriesInfoResponseSchema,
  cricketDataSeriesPointsResponseSchema,
  cricketDataStatsResponseSchema,
  type CricketDataSeriesInfoResponse,
  type CricketDataSeriesPointsResponse,
  type CricketDataStatsResponse,
} from "@/lib/providers/cricketdata-dto";
import type { PlayerStat, StandingsProvider, TeamStanding, TournamentResult } from "@/lib/providers/types";
import { playerStatSchema, teamStandingSchema } from "@/lib/schemas/providers";
import type { ZodType } from "zod";

// Matches the global `fetch` signature closely enough to inject a fake in
// tests without pulling in a mocking library — same spirit as
// src/lib/providers/ingest-auth.ts's default-export-for-spying trick, but
// simpler since this is a constructor parameter, not a module import.
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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

interface TeamLookup {
  byProviderKey: Map<string, string>;
  byName: Map<string, string>;
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
    const response = await this.request<CricketDataSeriesPointsResponse>(
      "/series_points",
      { apikey: this.apiKey, id: seriesId },
      cricketDataSeriesPointsResponseSchema
    );
    const rows = response.data ?? [];
    const teams = await this.loadTeams(tournamentId);

    const mapped: TeamStanding[] = [];
    rows.forEach((row, index) => {
      const teamId = this.resolveTeamId(teams, row.teamId, row.teamName);
      if (!teamId) {
        console.warn(
          `CricketDataProvider: no team mapping for "${row.teamName}" on tournament ${tournamentId}, skipping row`
        );
        return;
      }
      mapped.push({
        teamId,
        played: row.matchPlayed,
        won: row.win,
        lost: row.loss,
        points: row.points,
        nrr: row.nrr,
        // CricketData.org's points table is assumed pre-sorted by rank; no
        // explicit rank field is documented, so position is derived from
        // response order.
        position: index + 1,
      });
    });

    return this.validateMapped(teamStandingSchema.array(), mapped, "table data");
  }

  async getStatLeaders(tournamentId: string, category: string): Promise<PlayerStat[]> {
    const seriesId = await this.seriesId(tournamentId);
    const response = await this.request<CricketDataStatsResponse>(
      `/stats/${encodeURIComponent(category)}`,
      { apikey: this.apiKey, id: seriesId },
      cricketDataStatsResponseSchema
    );
    const rows = response.data ?? [];
    const players = await this.loadPlayers(tournamentId);

    const mapped: PlayerStat[] = [];
    for (const row of rows) {
      const playerId = (row.playerId && players.byProviderKey.get(row.playerId)) ?? players.byName.get(row.playerName.toLowerCase());
      if (!playerId) {
        console.warn(
          `CricketDataProvider: no player mapping for "${row.playerName}" (category ${category}, tournament ${tournamentId}), skipping row`
        );
        continue;
      }
      mapped.push({ playerId, value: row.value });
    }

    return this.validateMapped(playerStatSchema.array(), mapped, `stat leaders (${category})`);
  }

  async getFinalResult(tournamentId: string): Promise<TournamentResult> {
    const seriesId = await this.seriesId(tournamentId);
    const response = await this.request<CricketDataSeriesInfoResponse>(
      "/series_info",
      { apikey: this.apiKey, id: seriesId },
      cricketDataSeriesInfoResponseSchema
    );
    const matches = response.data?.matchList ?? [];
    const finalMatch = matches.find(
      (match) => (match.matchType ?? "").toLowerCase() === "final" || (match.name ?? "").toLowerCase().includes("final")
    );
    if (!finalMatch?.matchWinner) {
      return {};
    }

    const teams = await this.loadTeams(tournamentId);
    const championTeamId = teams.byName.get(finalMatch.matchWinner.toLowerCase());
    if (!championTeamId) {
      console.warn(
        `CricketDataProvider: final-match winner "${finalMatch.matchWinner}" has no team mapping on tournament ${tournamentId}`
      );
      return {};
    }
    return { championTeamId };
  }

  private resolveTeamId(teams: TeamLookup, providerTeamId: string | undefined, teamName: string): string | undefined {
    if (providerTeamId) {
      const byId = teams.byProviderKey.get(providerTeamId);
      if (byId) return byId;
    }
    return teams.byName.get(teamName.toLowerCase());
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

  private async loadTeams(tournamentId: string): Promise<TeamLookup> {
    const rows = await this.db.select().from(team).where(eq(team.tournamentId, tournamentId));
    const byProviderKey = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const row of rows) {
      if (row.providerKey) byProviderKey.set(row.providerKey, row.id);
      byName.set(row.name.toLowerCase(), row.id);
      byName.set(row.shortName.toLowerCase(), row.id);
    }
    return { byProviderKey, byName };
  }

  private async loadPlayers(tournamentId: string): Promise<TeamLookup> {
    const rows = await this.db.select().from(player).where(eq(player.tournamentId, tournamentId));
    const byProviderKey = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const row of rows) {
      if (row.providerKey) byProviderKey.set(row.providerKey, row.id);
      byName.set(row.name.toLowerCase(), row.id);
    }
    return { byProviderKey, byName };
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
