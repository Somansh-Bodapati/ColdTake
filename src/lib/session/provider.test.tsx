// Regression test for the production bug (Session 16): a real, valid
// session cookie survives closing and reopening a tab just fine (see
// src/lib/auth/session.test.ts's cookie round-trip test) — the actual
// defect was here, on the client. The very first GET /api/me a brand-new
// tab makes is also the request most likely to land on a cold path (the
// serverless function and DB connection behind it may have gone idle while
// the tab was closed). The old code treated ANY fetchMe() failure —
// confirmed-signed-out (401) or merely couldn't-tell (network error,
// timeout, a 500) — identically: `applyMe(null)`, which flips the UI to
// "signed out" and shows the enter-your-name form. Submitting that mints a
// brand-new session cookie under the same name, silently shadowing the
// still-valid one and orphaning access to whatever group the admin owned.
//
// This asserts the fix: a transient (non-401) failure on the initial mount
// fetch is retried once before the provider gives up and declares the user
// signed out.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SessionProvider } from "./provider";
import { useSession } from "./use-session";

function Probe() {
  const { status, user } = useSession();
  return <div data-testid="status">{status}:{user?.displayName ?? "none"}</div>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SessionProvider mount fetch", () => {
  it("stays loading, then signs in, when the first /api/me call fails transiently but a retry succeeds", async () => {
    const me = {
      user: { id: "u1", displayName: "Priya", email: null, avatarSeed: "u1", claimedAt: null },
      groups: [],
    };
    const fetchMock = vi
      .fn()
      // First call: simulates a cold-start/network blip — NOT a 401.
      .mockRejectedValueOnce(new TypeError("network error"))
      // Retry succeeds once the connection is warm.
      .mockResolvedValueOnce(jsonResponse(me));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>
    );

    expect(screen.getByTestId("status")).toHaveTextContent("loading:none");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2000 });
    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("signed-in:Priya")
    );
  });

  it("only settles into signed-out after a confirmed 401, not a transient error", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "Not signed in" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("signed-out:none")
    );
    // A real 401 is a confirmed answer — no retry needed, no second call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to signed-out only once both the first attempt and the retry fail", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockRejectedValueOnce(new TypeError("network error again"));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("status")).toHaveTextContent("signed-out:none")
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
