#!/usr/bin/env -S pnpm tsx
//
// Read-path load simulation — Session 16 (cost verification).
//
// Purpose: exercise the app's main read endpoints at a rate approximating
// 1,000 users checking in throughout a live tournament day, so the resulting
// request volume/pattern can be pointed at a real Neon-backed deployment to
// watch actual CU-hour consumption (Neon dashboard -> Monitoring -> Compute)
// and Vercel Active CPU (Vercel dashboard -> Usage). There is no deployed
// instance yet (docs/DECISIONS.md — local dev only), so today this only
// proves the script itself works against `pnpm dev` / a local API; it is
// meant to be re-run later, unmodified beyond BASE_URL and the fixture ids,
// against the real deployment.
//
// Why plain fetch-in-a-loop instead of a load-testing dependency
// (autocannon etc.): this app's entire cost problem is Neon's 100 CU-hour/
// month ceiling, not raw HTTP throughput — nothing here needs to be
// pushed to find a requests/sec limit, Vercel Hobby's 1M invocations and 4
// CPU-hours make that a non-issue at this scale (doc 02 §1.1). What's needed
// is a *realistic, sustained, low-concurrency request pattern over minutes*,
// which a small pool of scheduled `fetch` calls does perfectly well with
// zero new dependencies (CLAUDE.md: "no new dependency without asking
// first"). A benchmarking tool's job — maximum throughput against one
// endpoint — is a different question than this one.
//
// Usage:
//   pnpm tsx scripts/load-simulate.ts
//
// Config (all via env vars, all optional — see defaults below):
//   BASE_URL            Origin to hit. Default http://localhost:5173 (`pnpm dev`).
//   SEASON_ID            A real season id — required for the season/picks/
//                         standings/share-card endpoints. Skipped (with a
//                         warning) if unset.
//   GROUP_ID              A real group id — required for the group-page
//                         endpoint. Skipped (with a warning) if unset.
//   SESSION_COOKIE         A raw session token (src/lib/auth/session.ts's
//                         ct_session cookie value) for a member of GROUP_ID.
//                         Without one, every authenticated endpoint 401s
//                         immediately — still a real (cheap) DB round trip
//                         via requireUser, but not representative of a real
//                         session. Public endpoints (share cards) work either way.
//   VIRTUAL_USERS         Concurrently-simulated users. Default 1000.
//   DURATION_SECONDS       How long to run. Default 120.
//   MIN_CHECKIN_MS/
//   MAX_CHECKIN_MS         Per-user think time between requests — how often
//                         one person checks the app. Defaults model doc 02
//                         §5's "checking standings throughout the day":
//                         30s-5min.
//   CONCURRENCY            Hard cap on simultaneous in-flight requests, independent
//                         of VIRTUAL_USERS (which mostly controls the
//                         schedule, not how many requests are in flight at
//                         once). Default 50.
//
// Output: a per-endpoint table (request count, status breakdown, average/
// p95 latency, Cache-Control / x-vercel-cache observed) plus a rough
// estimate of total SQL round trips implied, using this session's audited
// per-endpoint query counts (src/lib/*/service.ts) as constants — a proxy
// for Neon CU-hours, not a replacement for actually watching the Neon
// dashboard during the run.

interface EndpointSpec {
  readonly name: string;
  readonly weight: number;
  readonly auditedQueryCount: number;
  readonly path: (ids: { seasonId?: string; groupId?: string }) => string | null;
}

const ENDPOINTS: readonly EndpointSpec[] = [
  {
    name: "GET /api/seasons/:id/standings",
    weight: 45,
    auditedQueryCount: 5,
    path: ({ seasonId }) => (seasonId ? `/api/seasons/${seasonId}/standings` : null),
  },
  {
    name: "GET /api/groups/:id",
    weight: 20,
    auditedQueryCount: 5,
    path: ({ groupId }) => (groupId ? `/api/groups/${groupId}` : null),
  },
  {
    name: "GET /api/seasons/:id",
    weight: 15,
    auditedQueryCount: 5,
    path: ({ seasonId }) => (seasonId ? `/api/seasons/${seasonId}` : null),
  },
  {
    name: "GET /api/seasons/:id/picks/mine",
    weight: 10,
    auditedQueryCount: 6,
    path: ({ seasonId }) => (seasonId ? `/api/seasons/${seasonId}/picks/mine` : null),
  },
  {
    name: "GET /api/me",
    weight: 5,
    auditedQueryCount: 2,
    path: () => "/api/me",
  },
  {
    name: "GET /api/cards/standings/:seasonId/:ts.png (public, immutable)",
    weight: 5,
    auditedQueryCount: 3,
    path: ({ seasonId }) =>
      // The real card route 404s unless :ts matches the snapshot's own
      // computed_at exactly (src/lib/cards/http.ts) — this deliberately hits
      // a bogus timestamp. That 404 still assembles the card data first
      // (src/lib/cards/assemble.ts runs before the timestamp check), so it
      // still costs the same DB reads a real cache-miss would; only a
      // *correct* timestamp would additionally hit the browser/CDN's
      // immutable cache on repeat views, which this script cannot forge.
      seasonId ? `/api/cards/standings/${seasonId}/load-sim-probe.png` : null,
  },
];

interface Config {
  baseUrl: string;
  seasonId: string | undefined;
  groupId: string | undefined;
  sessionCookie: string | undefined;
  virtualUsers: number;
  durationMs: number;
  minCheckinMs: number;
  maxCheckinMs: number;
  concurrency: number;
}

function readConfig(): Config {
  const env = process.env;
  return {
    baseUrl: env.BASE_URL ?? "http://localhost:5173",
    seasonId: env.SEASON_ID,
    groupId: env.GROUP_ID,
    sessionCookie: env.SESSION_COOKIE,
    virtualUsers: Number(env.VIRTUAL_USERS ?? 1000),
    durationMs: Number(env.DURATION_SECONDS ?? 120) * 1000,
    minCheckinMs: Number(env.MIN_CHECKIN_MS ?? 30_000),
    maxCheckinMs: Number(env.MAX_CHECKIN_MS ?? 300_000),
    concurrency: Number(env.CONCURRENCY ?? 50),
  };
}

interface RequestResult {
  endpoint: string;
  status: number;
  latencyMs: number;
  cacheControl: string | null;
  vercelCache: string | null;
}

// Simple counting semaphore — caps simultaneous in-flight fetches at
// `concurrency` regardless of how many virtual users are "awake" at once,
// so this script itself never becomes the thing that overloads a local dev
// server (or, against a real deploy, a load generator rather than a
// realistic-traffic generator).
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = concurrency;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.available -= 1;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}

function pickWeighted(endpoints: readonly EndpointSpec[]): EndpointSpec {
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const endpoint of endpoints) {
    roll -= endpoint.weight;
    if (roll <= 0) {
      return endpoint;
    }
  }
  // Only reachable via floating-point rounding at the very end of the range.
  const fallback = endpoints[endpoints.length - 1];
  if (!fallback) {
    throw new Error("ENDPOINTS must be non-empty");
  }
  return fallback;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function performOneRequest(
  config: Config,
  semaphore: Semaphore,
  endpoint: EndpointSpec,
  path: string,
  results: RequestResult[]
): Promise<void> {
  const release = await semaphore.acquire();
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(path, config.baseUrl), {
      headers: config.sessionCookie ? { cookie: `ct_session=${config.sessionCookie}` } : {},
    });
    // Drain the body so the connection is actually freed (a PNG or JSON
    // body left unread can keep the socket open under some fetch impls).
    await response.arrayBuffer();
    results.push({
      endpoint: endpoint.name,
      status: response.status,
      latencyMs: performance.now() - startedAt,
      cacheControl: response.headers.get("cache-control"),
      vercelCache: response.headers.get("x-vercel-cache"),
    });
  } catch (error) {
    results.push({
      endpoint: endpoint.name,
      status: 0,
      latencyMs: performance.now() - startedAt,
      cacheControl: null,
      vercelCache: null,
    });
    console.error(`Request to ${path} failed:`, error instanceof Error ? error.message : error);
  } finally {
    release();
  }
}

// One simulated user: wakes up on a random cadence between MIN/MAX_CHECKIN_MS
// (doc 02 §5's "checking standings throughout the day"), picks one endpoint
// per the weighted distribution above, fires it, and repeats until the run's
// overall deadline.
async function runVirtualUser(
  config: Config,
  semaphore: Semaphore,
  availableEndpoints: readonly EndpointSpec[],
  ids: { seasonId?: string; groupId?: string },
  deadline: number,
  results: RequestResult[]
): Promise<void> {
  // Stagger the very first check-in so 1,000 users don't all fire in the
  // same instant a process start would otherwise produce.
  await sleep(Math.random() * config.maxCheckinMs);

  while (Date.now() < deadline) {
    const endpoint = pickWeighted(availableEndpoints);
    const path = endpoint.path(ids);
    if (path) {
      await performOneRequest(config, semaphore, endpoint, path, results);
    }
    await sleep(randomBetween(config.minCheckinMs, config.maxCheckinMs));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function printReport(config: Config, results: readonly RequestResult[]): void {
  console.log("\n=== Load simulation report ===");
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Virtual users: ${config.virtualUsers}, duration: ${config.durationMs / 1000}s`);
  console.log(`Total requests fired: ${results.length}\n`);

  const byEndpoint = new Map<string, RequestResult[]>();
  for (const result of results) {
    const list = byEndpoint.get(result.endpoint) ?? [];
    list.push(result);
    byEndpoint.set(result.endpoint, list);
  }

  let estimatedTotalQueries = 0;
  const rows: string[] = [];
  for (const endpoint of ENDPOINTS) {
    const endpointResults = byEndpoint.get(endpoint.name) ?? [];
    if (endpointResults.length === 0) continue;

    const latencies = endpointResults.map((r) => r.latencyMs).sort((a, b) => a - b);
    const statusCounts = new Map<number, number>();
    for (const r of endpointResults) {
      statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
    }
    const cacheHits = endpointResults.filter(
      (r) => r.vercelCache === "HIT" || (r.status === 200 && r.cacheControl?.includes("max-age"))
    ).length;

    estimatedTotalQueries += endpointResults.length * endpoint.auditedQueryCount;

    const statusSummary = [...statusCounts.entries()]
      .map(([status, count]) => `${status}x${count}`)
      .join(" ");
    rows.push(
      `${endpoint.name}\n` +
        `  requests=${endpointResults.length} status=[${statusSummary}] ` +
        `cache-eligible=${cacheHits} avg=${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0)}ms ` +
        `p95=${percentile(latencies, 95).toFixed(0)}ms`
    );
  }
  console.log(rows.join("\n\n"));

  console.log(
    `\nEstimated total SQL round trips this run implied: ~${estimatedTotalQueries}\n` +
      "(using this session's audited per-endpoint query counts as a proxy — " +
      "see the Session 16 report for how each was measured). This is not a " +
      "substitute for watching actual Neon compute (Neon dashboard -> " +
      "Monitoring) or Vercel Active CPU (Vercel dashboard -> Usage) while " +
      "this script runs against a real deployment."
  );
}

async function main(): Promise<void> {
  const config = readConfig();
  if (!config.seasonId) {
    console.warn("SEASON_ID not set — season/picks/standings/card endpoints will be skipped.");
  }
  if (!config.groupId) {
    console.warn("GROUP_ID not set — the group-page endpoint will be skipped.");
  }
  if (!config.sessionCookie) {
    console.warn(
      "SESSION_COOKIE not set — authenticated endpoints will 401 immediately " +
        "(still a real requireUser DB round trip, just not representative traffic)."
    );
  }

  const availableEndpoints = ENDPOINTS.filter(
    (e) => e.path({ seasonId: config.seasonId, groupId: config.groupId }) !== null
  );
  if (availableEndpoints.length === 0) {
    throw new Error("No endpoints are reachable with the given SEASON_ID/GROUP_ID — nothing to simulate.");
  }

  const semaphore = new Semaphore(config.concurrency);
  const results: RequestResult[] = [];
  const deadline = Date.now() + config.durationMs;
  const ids = { seasonId: config.seasonId, groupId: config.groupId };

  console.log(
    `Starting: ${config.virtualUsers} virtual users, ${config.durationMs / 1000}s, ` +
      `concurrency cap ${config.concurrency}, check-in every ${config.minCheckinMs / 1000}-${config.maxCheckinMs / 1000}s...`
  );

  const users = Array.from({ length: config.virtualUsers }, () =>
    runVirtualUser(config, semaphore, availableEndpoints, ids, deadline, results)
  );
  await Promise.all(users);

  printReport(config, results);
}

main().catch((error: unknown) => {
  console.error("Load simulation failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
