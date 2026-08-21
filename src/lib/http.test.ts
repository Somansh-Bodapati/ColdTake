import { afterEach, describe, expect, it } from "vitest";
import { appUrl, pathSegment, requestUrl } from "./http.js";

// Vercel's Node runtime hands handlers a Request whose `.url` is a bare path
// (observed in production: "/api/me?...slug=me"), not the absolute URL our
// local dev server and every hand-built test Request use. `new URL()` throws
// on that without a base — this is exactly what broke every route in
// production after the ESM-extension fix, since the pathname could no
// longer be parsed at all.
describe("requestUrl", () => {
  it("parses an absolute request URL directly", () => {
    const request = new Request("http://localhost:5173/api/me");
    expect(requestUrl(request).pathname).toBe("/api/me");
  });

  it("falls back to the Host header when request.url is a bare path, as Vercel sends", () => {
    const request = new Request("http://placeholder/api/me?...slug=me", {
      headers: { host: "coldtake.vercel.app" },
    });
    // Simulate what Vercel's runtime actually hands the handler: a Request
    // whose .url is relative. The global Request constructor won't accept a
    // relative first argument, so this reassigns .url the way our own
    // Request-shape assumptions must tolerate — see api/gateway.ts.
    Object.defineProperty(request, "url", { value: "/api/me?...slug=me" });
    expect(requestUrl(request).pathname).toBe("/api/me");
  });

  it("falls back to localhost when even the Host header is missing", () => {
    const request = new Request("http://placeholder/api/groups/abc123");
    Object.defineProperty(request, "url", { value: "/api/groups/abc123" });
    expect(requestUrl(request).pathname).toBe("/api/groups/abc123");
  });
});

describe("pathSegment", () => {
  it("reads a trailing path segment from a relative request.url", () => {
    const request = new Request("http://placeholder/api/groups/abc123");
    Object.defineProperty(request, "url", { value: "/api/groups/abc123" });
    expect(pathSegment(request, 0)).toBe("abc123");
  });
});

// A trailing slash on APP_URL (e.g. "https://example.vercel.app/") is a
// completely reasonable thing for someone to paste into an env var UI —
// production actually hit this: it produced a double slash
// ("https://example.vercel.app//api/auth/google/callback"), which Google's
// OAuth rejects outright as redirect_uri_mismatch since it requires a
// byte-for-byte match against a registered URI.
describe("appUrl", () => {
  const ORIGINAL = process.env.APP_URL;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = ORIGINAL;
  });

  it("strips a trailing slash so concatenation never produces a double slash", () => {
    process.env.APP_URL = "https://example.vercel.app/";
    expect(appUrl()).toBe("https://example.vercel.app");
    expect(`${appUrl()}/api/auth/google/callback`).toBe(
      "https://example.vercel.app/api/auth/google/callback"
    );
  });

  it("strips multiple trailing slashes", () => {
    process.env.APP_URL = "https://example.vercel.app//";
    expect(appUrl()).toBe("https://example.vercel.app");
  });

  it("leaves a URL with no trailing slash unchanged", () => {
    process.env.APP_URL = "https://example.vercel.app";
    expect(appUrl()).toBe("https://example.vercel.app");
  });

  it("falls back to localhost:5173 when unset", () => {
    delete process.env.APP_URL;
    expect(appUrl()).toBe("http://localhost:5173");
  });
});
