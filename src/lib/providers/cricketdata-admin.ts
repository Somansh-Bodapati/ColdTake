// Admin-facing CricketData.org lookups behind tournament creation (POST
// /api/admin/cricketdata/search-series and POST /api/admin/tournaments) —
// the one-time "find a real series, learn its teams" path an admin walks
// BEFORE any tournament row exists. Deliberately separate from
// CricketDataProvider (cricketdata-provider.ts), which only ever calls
// series_info for an EXISTING tournament's providerKey and is keyed off a
// tournamentId this flow doesn't have yet. The fetch/timeout/schema-validate
// shape below is intentionally duplicated from that file's private
// `request` method rather than extracted into a shared helper — reusing
// tonight's freshly-verified provider internals across a second call site
// this late risks destabilizing the already-shipped ingest path for a
// convenience that saves ~20 lines.

import type { ZodType } from "zod";
import type { Db } from "../auth/session.js";
import { team, tournament } from "../db/schema.js";
import { createId } from "../db/id.js";
import { AppError } from "../errors.js";
import {
  cricketDataSeriesInfoResponseSchema,
  cricketDataSeriesListResponseSchema,
  type CricketDataMatchListEntry,
  type CricketDataSeriesInfoResponse,
  type CricketDataSeriesListEntry,
} from "./cricketdata-dto.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// Same "transient, might succeed on retry" signal as
// cricketdata-provider.ts's ProviderFetchError — kept as a distinct class
// (rather than reusing that one) so this admin-only surface can be caught
// and reported independently of the ingest path.
export class CricketDataAdminFetchError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "CricketDataAdminFetchError";
  }
}

export interface CricketDataAdminOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.cricapi.com/v1";
const DEFAULT_TIMEOUT_MS = 8000;

async function request<T>(
  options: CricketDataAdminOptions,
  path: string,
  params: Record<string, string>,
  schema: ZodType<T>
): Promise<T> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = new URL(baseUrl + path);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { signal: controller.signal });
  } catch (error) {
    throw new CricketDataAdminFetchError(`CricketData request to ${path} failed or timed out`, error);
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    throw new CricketDataAdminFetchError(`CricketData request to ${path} returned HTTP ${response.status}`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    throw new CricketDataAdminFetchError(`CricketData response from ${path} was not valid JSON`, error);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new CricketDataAdminFetchError(
      `CricketData response from ${path} did not match the expected shape: ${parsed.error.message}`
    );
  }

  const data = parsed.data as { status?: string; reason?: string };
  if (data.status === "failure") {
    throw new CricketDataAdminFetchError(`CricketData reported failure for ${path}: ${data.reason ?? "unknown reason"}`);
  }

  return parsed.data;
}

export interface CricketDataSeriesSearchResult {
  entries: CricketDataSeriesListEntry[];
  total: number;
  // Null once every row has been returned -- offsetRows + this page's
  // length reaching totalRows -- so the caller knows there's no more to
  // "Load more" without a guessing follow-up call.
  nextOffset: number | null;
}

// GET /v1/series?apikey=X&offset=<offset>&search=<query> — one request per
// call, costs one hit against the shared 100/day free-tier budget.
// offset is row-based (verified live: offset=1 shifted the result set by
// exactly one row, not one page) -- pass the previous call's nextOffset to
// page forward.
export async function searchCricketDataSeries(
  options: CricketDataAdminOptions,
  query: string,
  offset = 0
): Promise<CricketDataSeriesSearchResult> {
  const response = await request(
    options,
    "/series",
    { apikey: options.apiKey, offset: String(offset), search: query },
    cricketDataSeriesListResponseSchema
  );
  const total = response.info?.totalRows ?? response.data.length;
  const seenThroughRow = offset + response.data.length;
  return {
    entries: response.data,
    total,
    nextOffset: seenThroughRow < total ? seenThroughRow : null,
  };
}

// GET /v1/series_info?apikey=X&offset=0&id=<seriesId> — one request. Used
// here (not by CricketDataProvider) once, at tournament-creation time, to
// derive the team roster; CricketDataProvider calls the same endpoint
// separately and routinely thereafter, keyed off tournament.providerKey.
export async function fetchCricketDataSeriesInfo(
  options: CricketDataAdminOptions,
  seriesId: string
): Promise<CricketDataSeriesInfoResponse> {
  return request(
    options,
    "/series_info",
    { apikey: options.apiKey, offset: "0", id: seriesId },
    cricketDataSeriesInfoResponseSchema
  );
}

// No dedicated "teams in series" endpoint exists on this tier (verified
// live tonight) — the team roster is derived by deduplicating `teams` names
// across every match in the series, case-sensitively as CricketData itself
// returns them (CricketDataProvider's table matching is case-INsensitive,
// so a stray casing difference here can't break it, but the stored name
// should read naturally in our own UI).
export function deriveTeamNamesFromMatchList(matchList: CricketDataMatchListEntry[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of matchList) {
    for (const name of match.teams) {
      const trimmed = name.trim();
      if (trimmed.length === 0) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(trimmed);
    }
  }
  return names;
}

// CricketData's series/series_info responses never carry a team short code
// (e.g. "MI") — only the full name. Derives a readable stand-in: initials
// of up to 4 words for a multi-word name, or the first 3 letters uppercased
// for a single-word name. Cosmetic only (schema.ts's team.shortName has no
// uniqueness constraint and nothing in scoring reads it structurally) — a
// group admin can rename it later if it collides or reads oddly.
export function deriveShortName(teamName: string): string {
  const words = teamName.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .map((word) => word[0])
      .join("")
      .slice(0, 4)
      .toUpperCase();
  }
  return (words[0] ?? teamName).slice(0, 3).toUpperCase();
}

// series_info's own `info.startdate`/`info.enddate` aren't guaranteed
// ISO-8601 (verified live tonight: a real response returned both "Sep 13"
// AND, for a real IPL 2026 series, "May 31" — both year-less — for
// enddate). `Date` happily "parses" a year-less month/day string by
// silently assuming some fixed reference year (observed: 2001) rather than
// throwing, which would otherwise persist a wildly wrong endsAt with no
// signal anything went wrong — so a value with no 4-digit year is treated
// as unparseable, same as outright garbage. `startsAt` is a NOT NULL column
// (schema.ts), so its fallback is "now"; `endsAt` is nullable, so its
// fallback is just null.
export function parseSeriesDate(value: string | undefined): Date | null {
  if (!value) return null;
  if (!/\d{4}/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface CreateTournamentFromSeriesInput {
  seriesId: string;
  seriesName: string;
}

export interface CreateTournamentFromSeriesResult {
  tournamentId: string;
  teamsCreated: number;
}

// The whole point of this file: one series_info call (the only network hit
// this function makes — task budget: "at most 2 real API calls" total
// including the preceding search), derive the team roster, and write the
// `tournament` + `team` rows that make CricketDataProvider (which reads
// tournament.providerKey as the series id and team.providerKey as the
// team's CricketData name, case-insensitively — see that file's
// `seriesId`/`loadTeamNames`) actually work against this tournament from
// here on. Player rows are deliberately NOT created — this tier has no
// series-scoped player roster endpoint verified working (see
// cricketdata-provider.ts's getStatLeaders comment); that's a permanent
// scope boundary, not a TODO.
export async function createTournamentFromCricketDataSeries(
  db: Db,
  options: CricketDataAdminOptions,
  input: CreateTournamentFromSeriesInput
): Promise<CreateTournamentFromSeriesResult> {
  const seriesInfo = await fetchCricketDataSeriesInfo(options, input.seriesId);
  const matchList = seriesInfo.data?.matchList ?? [];
  const teamNames = deriveTeamNamesFromMatchList(matchList);
  if (teamNames.length === 0) {
    throw new AppError(400, `CricketData series ${input.seriesId} has no teams in its match list yet — pick a different series`);
  }

  const startsAt = parseSeriesDate(seriesInfo.data?.info?.startdate) ?? new Date();
  const endsAt = parseSeriesDate(seriesInfo.data?.info?.enddate);

  const tournamentId = `cricketdata-${createId()}`;
  // shortName has no length constraint in the schema, but the UI shows it
  // in compact spots (e.g. season-new.tsx's tournament <select>) — a real
  // series name can run long ("Pakistan tour of England 2026, 3rd Test
  // Match"), so it's truncated the same way any other long label would be.
  const shortName = input.seriesName.length > 40 ? `${input.seriesName.slice(0, 37)}...` : input.seriesName;

  await db.insert(tournament).values({
    id: tournamentId,
    sport: "cricket",
    name: input.seriesName,
    shortName,
    startsAt,
    endsAt,
    status: "upcoming",
    teamCount: teamNames.length,
    providerKey: input.seriesId,
    config: { provider: "cricketdata" },
  });

  await db.insert(team).values(
    teamNames.map((name) => ({
      id: createId(),
      tournamentId,
      name,
      shortName: deriveShortName(name),
      providerKey: name,
    }))
  );

  return { tournamentId, teamsCreated: teamNames.length };
}
