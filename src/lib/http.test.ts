import { describe, expect, it } from "vitest";
import { pathSegment, requestUrl } from "./http.js";

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
