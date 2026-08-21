// The only file left under api/ — every request under /api/* is funneled
// here by vercel.json's rewrite ({ "source": "/api/(.*)", "destination":
// "/api/gateway" }), which hands the full original request to this one
// Function so we can dispatch internally via src/server/router.ts instead of
// letting Vercel turn each of the 32 handlers under src/server/ into its own
// Function (Hobby plan caps a deployment at 12).
//
// IMPORTANT — this file is NOT named api/[...slug].ts on purpose. That
// bracket catch-all syntax is a Next.js-only convention; plain (non-Next.js)
// Vercel Serverless Functions only match a SINGLE path segment per dynamic
// file (confirmed via Vercel's own maintainers, August 2026 — see
// github.com/vercel/vercel/discussions/8343). A file named api/[...slug].ts
// deployed exactly like this one silently only matched one-segment paths
// (/api/me, /api/tournaments) and 404'd at Vercel's platform level — before
// ever reaching this code — for anything nested (/api/auth/anonymous,
// /api/groups/join). The vercel.json rewrite above is what actually captures
// every depth; this file's own name is otherwise arbitrary (it's never
// reached by Vercel's own filesystem routing, only via that rewrite).
// Rewrites are transparent to the destination function — request.url still
// reflects the ORIGINAL requested path, which is what requestUrl()/
// matchRoute() below rely on.
//
// IMPORTANT — Vercel's Node.js runtime has THREE distinct handler contracts
// for a file under api/*, and picks between them based on what the file
// exports (see vercel.com/docs/functions/functions-api-reference and
// vercel.com/docs/functions/runtimes/node-js, confirmed August 2026):
//   1. Named per-method exports — `export function GET(request: Request)`
//   2. The "fetch Web Standard export" — `export default { fetch(request) }`
//      — a single function handling every HTTP method, real WHATWG Request.
//   3. A bare default function export — `export default function(req, res)`
//      / `module.exports = (req, res) => ...` — Vercel's classic, legacy
//      Node convention (`@vercel/node`'s `VercelRequest`/`VercelResponse`),
//      which extend `http.IncomingMessage`/`http.ServerResponse`: `.url` is
//      a bare path, `.headers` is a plain object with no `.get()`.
//
// This file used to have a bare `export default async function handler(...)`
// — contract #3 — which is why production actually invoked it with a
// classic Node req (bare-path `.url`, plain-object `.headers`), not the Web
// `Request` the code assumed. Wrapping the same handler as `{ fetch: ... }`
// (contract #2) is the zero-config, officially documented way to get a real
// `Request` for every method in one function — no `@vercel/node` adapter,
// no (req, res) translation layer, and zero changes to src/server/**'s
// `(request: Request) => Promise<Response>` contract.

import { matchRoute } from "../src/server/router.js";
import { jsonResponse, requestUrl } from "../src/lib/http.js";

async function handler(request: Request): Promise<Response> {
  const { pathname } = requestUrl(request);
  const match = matchRoute(pathname);

  if (!match) {
    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  return match.handler(request);
}

export default { fetch: handler };
