// Single source of truth for the API's URL -> handler mapping, shared by
// both the production catch-all Vercel Function (api/gateway.ts) and the
// local dev middleware (vite-plugins/api-dev-server.ts). Exists because
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and this
// project has 34 route handlers under src/server/ — every file under api/
// becomes its own Function, so all 32 handlers are consolidated behind the
// one catch-all file and dispatched internally via this static table
// instead.
//
// Imports are static (not dynamic `import()`) so Vercel's bundler traces
// every handler's dependency graph into the one Function's bundle — a
// dynamic import per route would risk some handlers' dependencies (DB
// client, scoring engine, etc.) being tree-shaken out or not bundled at all.

import meHandler from "./me.js";
import authAnonymousHandler from "./auth/anonymous.js";
import authClaimHandler from "./auth/claim.js";
import authLogoutHandler from "./auth/logout.js";
import authVerifyHandler from "./auth/verify.js";
import adminManualStandingsHandler from "./admin/manual-standings/[tournamentId].js";
import adminCricketDataSearchSeriesHandler from "./admin/cricketdata/search-series.js";
import adminTournamentsHandler from "./admin/tournaments.js";
import cardsRecapHandler from "./cards/recap/[seasonId]/[timestamp].js";
import cardsRevealHandler from "./cards/reveal/[seasonId]/[timestamp].js";
import cardsStandingsHandler from "./cards/standings/[seasonId]/[timestamp].js";
import cardsSwingHandler from "./cards/swing/[seasonId]/[timestamp].js";
import groupsIndexHandler from "./groups/index.js";
import groupsJoinHandler from "./groups/join.js";
import groupsByCodeHandler from "./groups/by-code/[code].js";
import groupByIdHandler from "./groups/[id]/index.js";
import groupTransferHandler from "./groups/[id]/transfer.js";
import groupMemberHandler from "./groups/[id]/members/[memberId].js";
import ingestHandler from "./ingest/[tournamentId].js";
import seasonsIndexHandler from "./seasons/index.js";
import seasonByIdHandler from "./seasons/[id]/index.js";
import seasonPublishHandler from "./seasons/[id]/publish.js";
import seasonRecomputeHandler from "./seasons/[id]/recompute.js";
import seasonSettleHandler from "./seasons/[id]/settle.js";
import seasonVoidHandler from "./seasons/[id]/void.js";
import seasonQuestionsIndexHandler from "./seasons/[id]/questions/index.js";
import seasonQuestionByIdHandler from "./seasons/[id]/questions/[qid].js";
import seasonQuestionSettleHandler from "./seasons/[id]/questions/[qid]/settle.js";
import seasonPicksIndexHandler from "./seasons/[id]/picks/index.js";
import seasonPicksMineHandler from "./seasons/[id]/picks/mine.js";
import seasonPicksAllHandler from "./seasons/[id]/picks/all.js";
import seasonStandingsIndexHandler from "./seasons/[id]/standings/index.js";
import seasonStandingsHistoryHandler from "./seasons/[id]/standings/history.js";
import tournamentsIndexHandler from "./tournaments/index.js";

export type Handler = (request: Request) => Promise<Response>;

export interface Route {
  pattern: string;
  handler: Handler;
}

// Order matters only in that static segments must be checked before dynamic
// ones at each level for a given prefix — matchRoute below enforces that by
// construction (it always tries a literal match before falling through to a
// dynamic one), so the array order here doesn't otherwise affect matching.
export const routes: Route[] = [
  { pattern: "/api/me", handler: meHandler },
  { pattern: "/api/auth/anonymous", handler: authAnonymousHandler },
  { pattern: "/api/auth/claim", handler: authClaimHandler },
  { pattern: "/api/auth/logout", handler: authLogoutHandler },
  { pattern: "/api/auth/verify", handler: authVerifyHandler },
  { pattern: "/api/admin/manual-standings/:tournamentId", handler: adminManualStandingsHandler },
  { pattern: "/api/admin/cricketdata/search-series", handler: adminCricketDataSearchSeriesHandler },
  { pattern: "/api/admin/tournaments", handler: adminTournamentsHandler },
  { pattern: "/api/cards/recap/:seasonId/:timestamp", handler: cardsRecapHandler },
  { pattern: "/api/cards/reveal/:seasonId/:timestamp", handler: cardsRevealHandler },
  { pattern: "/api/cards/standings/:seasonId/:timestamp", handler: cardsStandingsHandler },
  { pattern: "/api/cards/swing/:seasonId/:timestamp", handler: cardsSwingHandler },
  { pattern: "/api/groups", handler: groupsIndexHandler },
  { pattern: "/api/groups/join", handler: groupsJoinHandler },
  { pattern: "/api/groups/by-code/:code", handler: groupsByCodeHandler },
  { pattern: "/api/groups/:id", handler: groupByIdHandler },
  { pattern: "/api/groups/:id/transfer", handler: groupTransferHandler },
  { pattern: "/api/groups/:id/members/:memberId", handler: groupMemberHandler },
  { pattern: "/api/ingest/:tournamentId", handler: ingestHandler },
  { pattern: "/api/seasons", handler: seasonsIndexHandler },
  { pattern: "/api/seasons/:id", handler: seasonByIdHandler },
  { pattern: "/api/seasons/:id/publish", handler: seasonPublishHandler },
  { pattern: "/api/seasons/:id/recompute", handler: seasonRecomputeHandler },
  { pattern: "/api/seasons/:id/settle", handler: seasonSettleHandler },
  { pattern: "/api/seasons/:id/void", handler: seasonVoidHandler },
  { pattern: "/api/seasons/:id/questions", handler: seasonQuestionsIndexHandler },
  { pattern: "/api/seasons/:id/questions/:qid", handler: seasonQuestionByIdHandler },
  {
    pattern: "/api/seasons/:id/questions/:qid/settle",
    handler: seasonQuestionSettleHandler,
  },
  { pattern: "/api/seasons/:id/picks", handler: seasonPicksIndexHandler },
  { pattern: "/api/seasons/:id/picks/mine", handler: seasonPicksMineHandler },
  { pattern: "/api/seasons/:id/picks/all", handler: seasonPicksAllHandler },
  { pattern: "/api/seasons/:id/standings", handler: seasonStandingsIndexHandler },
  { pattern: "/api/seasons/:id/standings/history", handler: seasonStandingsHistoryHandler },
  { pattern: "/api/tournaments", handler: tournamentsIndexHandler },
];

interface CompiledRoute {
  segments: string[]; // e.g. ["api", "groups", ":id"]
  route: Route;
}

const compiledRoutes: CompiledRoute[] = routes.map((route) => ({
  segments: route.pattern.split("/").filter(Boolean),
  route,
}));

export interface RouteMatch {
  handler: Handler;
  params: Record<string, string>;
}

// Segment-by-segment matcher: a static segment must match the request
// segment's literal text exactly; a `:param` segment matches any single
// non-empty segment. Where two patterns could structurally match the same
// request (e.g. "/api/groups/join" vs "/api/groups/:id"), the static
// pattern is preferred by scoring every candidate and picking the one with
// the fewest dynamic segments — a match with 0 dynamic segments always beats
// one with 1+, regardless of array order.
export function matchRoute(pathname: string): RouteMatch | null {
  const requestSegments = pathname.split("/").filter(Boolean);

  let best: { route: Route; params: Record<string, string>; dynamicCount: number } | null = null;

  for (const { segments, route } of compiledRoutes) {
    if (segments.length !== requestSegments.length) {
      continue;
    }

    const params: Record<string, string> = {};
    let dynamicCount = 0;
    let matched = true;

    for (let i = 0; i < segments.length; i++) {
      const patternSegment = segments[i];
      const requestSegment = requestSegments[i];
      if (patternSegment.startsWith(":")) {
        if (!requestSegment) {
          matched = false;
          break;
        }
        params[patternSegment.slice(1)] = decodeURIComponent(requestSegment);
        dynamicCount++;
      } else if (patternSegment !== requestSegment) {
        matched = false;
        break;
      }
    }

    if (!matched) {
      continue;
    }

    if (best === null || dynamicCount < best.dynamicCount) {
      best = { route, params, dynamicCount };
    }
  }

  if (best === null) {
    return null;
  }
  return { handler: best.route.handler, params: best.params };
}
