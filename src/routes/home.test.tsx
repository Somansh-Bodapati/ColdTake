// Real bug, reported in production tonight: a brand-new Google sign-in
// lands on "/?welcome=1", confirming a name returns 200 and (per the
// component's own logic) calls refresh(), but the "What should we call
// you?" prompt never went away. Root cause: showWelcomeParam was read once
// from the URL into state with no setter, then OR'd into showNamePrompt
// forever — so even after the server-side needsNamePrompt flipped to
// false, the one-time welcome flag kept the prompt open indefinitely.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import "@testing-library/jest-dom/vitest";

const useSessionMock = vi.fn();

vi.mock("@/lib/session/use-session", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("@/lib/groups/client", () => ({
  createGroupRequest: vi.fn(),
  joinGroupRequest: vi.fn(),
}));

import Home from "./home";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Home />
    </MemoryRouter>
  );
}

describe("Home — one-time name prompt after Google sign-in", () => {
  it("hides the prompt once confirmName resolves, even though it arrived via ?welcome=1", async () => {
    window.history.replaceState({}, "", "/?welcome=1");

    let needsNamePrompt = true;
    const refresh = vi.fn().mockResolvedValue(undefined);
    const confirmName = vi.fn().mockImplementation(async () => {
      // Mirrors the real flow: the server confirms the name, and a refresh
      // would re-fetch /api/me with needsNamePrompt now false.
      needsNamePrompt = false;
    });

    useSessionMock.mockImplementation(() => ({
      status: "signed-in",
      user: {
        id: "user-1",
        displayName: "Player",
        email: "player@example.com",
        avatarSeed: "player",
        needsNamePrompt,
      },
      groups: [],
      refresh,
      confirmName,
      claimEmail: vi.fn(),
      logout: vi.fn(),
    }));

    renderAt("/?welcome=1");

    expect(screen.getByText("What should we call you?")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Player");
    input.focus();
    (input as HTMLInputElement).value = "Somansh";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const form = screen.getByRole("button", { name: /continue/i }).closest("form");
    expect(form).not.toBeNull();
    form!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

    await waitFor(() => expect(confirmName).toHaveBeenCalled());

    // This is the exact bug: before the fix, this stayed in the document
    // forever because showWelcomeParam never got reset.
    await waitFor(() =>
      expect(screen.queryByText("What should we call you?")).not.toBeInTheDocument()
    );
  });

  it("does not show the prompt at all for a returning user with no ?welcome=1 and needsNamePrompt already false", () => {
    useSessionMock.mockImplementation(() => ({
      status: "signed-in",
      user: {
        id: "user-1",
        displayName: "Somansh",
        email: "somansh@example.com",
        avatarSeed: "somansh",
        needsNamePrompt: false,
      },
      groups: [],
      refresh: vi.fn(),
      confirmName: vi.fn(),
      claimEmail: vi.fn(),
      logout: vi.fn(),
    }));

    renderAt("/");

    expect(screen.queryByText("What should we call you?")).not.toBeInTheDocument();
  });
});
