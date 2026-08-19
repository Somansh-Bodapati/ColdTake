// In-memory, per-process rate limiter for POST /api/groups/join (this
// session's brief, task 7: "rate-limit the join endpoint").
//
// KNOWN LIMITATION — read before trusting this in production: there is no
// Redis/external rate-limit store wired up yet (docs/DECISIONS.md doesn't
// mention one, and none was authorized for this session — "no new
// dependency without asking first", CLAUDE.md). This Map lives in one
// process's memory, so it does NOT protect against:
//   - serverless cold starts: a fresh Vercel function instance gets a fresh,
//     empty Map, silently resetting anyone's counter.
//   - multiple concurrent instances: Vercel can (and under load, will) run
//     several instances of this function at once, each with its own Map, so
//     the *effective* limit is `limit * (number of warm instances)`, not
//     `limit`.
// It still stops a single naive script hammering one warm instance, which
// is a real (if partial) improvement over no limit at all — but it is not a
// substitute for a shared store (Redis/Upstash + sliding window, or a DB
// table) before this matters for real abuse resistance. Swap the storage
// underneath `hit()` for that later; the call site (api/groups/join.ts)
// doesn't need to change.

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

// Fixed-window counter: `limit` attempts per `windowMs`, keyed by whatever
// the caller passes (IP address for the join endpoint, since the thing
// being defended against is brute-forcing someone else's join code, not
// just one user's own request rate).
export function hitRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now: number = Date.now()
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= options.windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= options.limit) {
    return { allowed: false, retryAfterMs: options.windowMs - (now - existing.windowStart) };
  }

  existing.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

// Test-only: without this, tests run in the same process share `buckets`
// and pollute each other's windows.
export function resetRateLimitForTests(): void {
  buckets.clear();
}
