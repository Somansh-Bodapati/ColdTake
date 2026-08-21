// The only file left under api/ — Vercel's catch-all Serverless Function
// convention (`[...slug].ts`, not the Next.js-only "optional catch-all"
// `[[...slug]].ts`) matches every request under /api/* to this one Function
// and hands it the full request, so we can dispatch internally via
// src/server/router.ts instead of letting Vercel turn each of the 32
// handlers under src/server/ into its own Function (Hobby plan caps a
// deployment at 12).
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
