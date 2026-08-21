// End-to-end coverage for the deployed Vercel Function's export contract.
//
// Every previous check (typecheck, lint, the 422-strong unit suite, and
// scripts/verify-vercel-function.mjs's module-resolution walk) passed while
// production was broken, because nothing ever asserted *how* this file must
// be exported for Vercel's Node.js runtime to actually call it with a real
// WHATWG `Request`. A bare `export default function handler(request)` looks
// exactly like the intended contract in every local tool — Vitest, tsc,
// even hand-built `new Request(...)` calls all work fine — but Vercel's
// runtime treats a bare default function export as its legacy Node
// `(req: IncomingMessage, res: ServerResponse)` handler (the same shape
// `@vercel/node`'s `VercelRequest`/`VercelResponse` extend), not a Web
// handler. That's the actual cause of the "TypeError: Invalid URL" and
// "request.headers.get is not a function" production crashes: `request` was
// a real `IncomingMessage`, whose `.url` is a bare path and whose `.headers`
// is a plain object with no `.get()`.
//
// The fix is the "fetch Web Standard export" Vercel documents as the
// zero-config way to receive a real `Request` for every HTTP method in one
// function (vercel.com/docs/functions/functions-api-reference#fetch-web-standard):
// `export default { fetch(request: Request): Promise<Response> }`. This test
// pins that exact shape, then drives the real exported `fetch` end-to-end
// through matchRoute -> a real handler -> a real Response, so a regression
// back to a bare default function (or any other shape Vercel would
// misinterpret) fails loudly here instead of only in production.
import { afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { user } from "../src/lib/db/schema";
import { SESSION_COOKIE_NAME } from "../src/lib/auth/session";
import apiFunction from "./[...slug]";

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(user).where(inArray(user.id, createdUserIds));
    createdUserIds.length = 0;
  }
});

describe("api/[...slug].ts default export contract", () => {
  it("is the 'fetch Web Standard export' shape Vercel requires for a Web Request, not a bare default function", () => {
    // A bare `export default function handler(request)` is exactly what
    // broke production: Vercel's Node runtime interprets that shape as its
    // classic (req, res) convention instead of a Web handler. Pinning both
    // sides of this assertion is what makes the regression loud.
    expect(typeof apiFunction).toBe("object");
    expect(typeof (apiFunction as { fetch?: unknown }).fetch).toBe("function");
  });
});

describe("api/[...slug].ts fetch handler (end-to-end)", () => {
  it("routes a GET request to its handler and returns a real JSON Response", async () => {
    // Exercises requestUrl()'s absolute-URL path (what the fetch export
    // actually receives from Vercel) rather than its relative-path
    // fallback, which src/lib/http.test.ts already covers in isolation.
    const request = new Request("http://localhost/api/tournaments");
    const response = await apiFunction.fetch(request);

    // Unauthenticated, so requireUser() rejects before any DB read — still
    // proves routing dispatched to the real tournaments handler and that a
    // genuine Response with real `.status`/`.headers` came back.
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("routes a POST request with a JSON body and returns an unmangled Set-Cookie header", async () => {
    const request = new Request("http://localhost/api/auth/anonymous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "E2E Slug Test" }),
    });
    const response = await apiFunction.fetch(request);

    expect(response.status).toBe(201);
    const body = (await response.json()) as { userId: string; sessionToken: string };
    createdUserIds.push(body.userId);
    expect(body.userId).toBeTruthy();

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    // getSetCookie() returns each Set-Cookie value as a separate array entry
    // rather than one comma-joined string — the correct way to check a
    // Set-Cookie header wasn't folded/mangled (HTTP forbids merging multiple
    // Set-Cookie values into one comma-joined header; a naive `.get()`-based
    // join would silently break the cookie's own Expires= date, which
    // already contains a ", " from toUTCString()).
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it("returns 404 JSON for an unmatched path", async () => {
    const request = new Request("http://localhost/api/this-route-does-not-exist");
    const response = await apiFunction.fetch(request);

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Not found");
  });
});
