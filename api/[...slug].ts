// The only file left under api/ — Vercel's catch-all Serverless Function
// convention (`[...slug].ts`, not the Next.js-only "optional catch-all"
// `[[...slug]].ts`) matches every request under /api/* to this one Function
// and hands it the full request, so we can dispatch internally via
// src/server/router.ts instead of letting Vercel turn each of the 32
// handlers under src/server/ into its own Function (Hobby plan caps a
// deployment at 12).
//
// Uses the same Web-standard Request/Response shape as every handler (see
// src/lib/http.ts) — Vercel Functions support this natively since Node 18,
// no @vercel/node request/response adapter needed.

import { matchRoute } from "../src/server/router.js";
import { jsonResponse } from "../src/lib/http.js";

export default async function handler(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const match = matchRoute(pathname);

  if (!match) {
    return jsonResponse({ error: "Not found" }, { status: 404 });
  }

  return match.handler(request);
}
