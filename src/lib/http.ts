// Shared plumbing for api/ handlers. Vercel Functions here use the
// Web-standard Request/Response (globally available since Node 18, no
// @vercel/node dependency needed) rather than the classic (req, res) style —
// it's the shape that's trivial to unit-test by constructing a Request
// directly and calling the handler, per doc 02 §"API routes: Vitest".

import type { ZodType } from "zod";
import { AppError } from "./errors.js";

// Vercel's Node runtime hands handlers a Request whose `.url` is sometimes a
// bare path (e.g. "/api/me?...slug=me") rather than an absolute URL — unlike
// our local dev server (vite-plugins/api-dev-server.ts), which always builds
// a full http://localhost:<port>/... URL, and unlike a Request built by hand
// in a test, which also uses an absolute URL. `new URL()` throws on a
// relative string with no base, so every parse goes through this helper,
// which supplies a base from the Host header when `.url` isn't absolute
// already (the value of the base is irrelevant beyond that — only the
// resulting `.pathname` is ever read).
// Every place that builds a link from APP_URL (Google OAuth's redirect_uri,
// the magic-link claim URL, share-card/invite links) was doing its own
// `${process.env.APP_URL}/...` concatenation — a trailing slash on the env
// var (e.g. "https://example.vercel.app/") silently produced a double slash
// ("https://example.vercel.app//api/..."), which Google's OAuth rejects
// outright as redirect_uri_mismatch since it must byte-for-byte match a
// registered URI. One normalized helper, used everywhere, so a
// misconfigured env var can't cause this again.
export function appUrl(): string {
  const raw = process.env.APP_URL ?? "http://localhost:5173";
  return raw.replace(/\/+$/, "");
}

export function requestUrl(request: Request): URL {
  try {
    return new URL(request.url);
  } catch {
    const host = request.headers.get("host") ?? "localhost";
    return new URL(request.url, `http://${host}`);
  }
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

// A genuine HTTP redirect (302) — used by the Google OAuth handlers, which
// need the browser to actually navigate (to Google's consent screen, then
// back to the app), not a JSON body a fetch() caller would have to act on.
export function redirectResponse(location: string, init: { headers?: HeadersInit } = {}): Response {
  // Built via the Headers constructor + explicit `.append`s rather than
  // object-spreading `init.headers` into a headers literal: a HeadersInit
  // can be a real `Headers` instance (e.g. the Google callback handler,
  // which needs two separate Set-Cookie headers — one for the session, one
  // to clear the oauth state cookie), and spreading a Headers instance into
  // a plain object copies none of its entries, since Headers stores them
  // internally rather than as enumerable own properties. `new Headers(init)`
  // is the spec-correct way to accept any HeadersInit shape (Headers,
  // [][], or Record<string,string>) and keep multi-value headers intact.
  const headers = new Headers(init.headers);
  headers.set("location", location);
  return new Response(null, { status: 302, headers });
}

// Parses and Zod-validates a JSON request body. Throws AppError(400) on
// malformed JSON or a schema mismatch — every API boundary parses with Zod
// (CLAUDE.md code standards).
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError(400, "Request body must be valid JSON");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError(400, result.error.issues[0]?.message ?? "Invalid request body");
  }
  return result.data;
}

// Pulls one path segment out of `request.url` by its position from the end
// (0 = last segment). Used by dynamic routes under api/groups/[id]/... to
// read :id/:memberId out of the URL directly, rather than relying on
// Vercel's convention of also injecting bracket segments as query params —
// parsing the pathname works identically against a real deployed request
// and a `new Request(...)` built by hand in a test.
export function pathSegment(request: Request, fromEnd: number): string {
  const { pathname } = requestUrl(request);
  const segments = pathname.split("/").filter(Boolean);
  const value = segments[segments.length - 1 - fromEnd];
  if (!value) {
    throw new AppError(400, "Missing path parameter");
  }
  return decodeURIComponent(value);
}

// Wraps a handler so a thrown AppError (or unexpected error) becomes a JSON
// error Response instead of an unhandled rejection reaching the runtime.
export function withErrorHandling(
  handler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof AppError) {
        return jsonResponse({ error: error.message }, { status: error.status });
      }
      console.error("Unhandled API error:", error);
      return jsonResponse({ error: "Internal server error" }, { status: 500 });
    }
  };
}
