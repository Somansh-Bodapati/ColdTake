// Component test for the bug where joining a group via /join/:code didn't
// show up on the home dashboard afterward. Root cause: SessionProvider
// fetches /api/me once on mount and caches `groups` in state; home.tsx's
// own join-by-code form already knew to call `refresh()` after a mutation,
// but this route's handleJoin did not, so the shared session state stayed
// stale after navigating back to "/". This test asserts the fix: a
// successful join calls the session's `refresh()` before showing the
// "You're in" state, so the destination route sees an up-to-date group list
// without a page reload or a second manual join.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import "@testing-library/jest-dom/vitest";

const useSessionMock = vi.fn();
const fetchGroupPreviewByCodeMock = vi.fn();
const joinGroupRequestMock = vi.fn();

vi.mock("@/lib/session/use-session", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("@/lib/groups/client", () => ({
  fetchGroupPreviewByCode: (code: string) => fetchGroupPreviewByCodeMock(code),
  joinGroupRequest: (code: string) => joinGroupRequestMock(code),
}));

// Importing after the mocks are registered (vi.mock is hoisted, but the
// dynamic import keeps intent obvious at the call site).
const { default: JoinPage } = await import("./join");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderJoinPage(code = "ABC234") {
  return render(
    <MemoryRouter initialEntries={[`/join?code=${code}`]}>
      <JoinPage />
    </MemoryRouter>
  );
}

describe("JoinPage", () => {
  it("refreshes the shared session's group list on a successful join", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useSessionMock.mockReturnValue({ status: "signed-in", refresh });
    fetchGroupPreviewByCodeMock.mockResolvedValue({ id: "group-1", name: "The Champions" });
    joinGroupRequestMock.mockResolvedValue({
      group: { id: "group-1", name: "The Champions", joinCode: "ABC234", role: "member" },
    });

    renderJoinPage();

    const joinButton = await screen.findByRole("button", { name: /join the champions/i });
    fireEvent.click(joinButton);

    await waitFor(() => expect(joinGroupRequestMock).toHaveBeenCalledWith("ABC234"));
    // The critical assertion: refresh() must be awaited as part of the join
    // flow, not left for the destination route to happen to refetch.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/you're in/i)).toBeInTheDocument();
  });

  it("does not refresh the session when the join request fails", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useSessionMock.mockReturnValue({ status: "signed-in", refresh });
    fetchGroupPreviewByCodeMock.mockResolvedValue({ id: "group-1", name: "The Champions" });
    joinGroupRequestMock.mockRejectedValue(new Error("Could not join the group"));

    renderJoinPage();

    const joinButton = await screen.findByRole("button", { name: /join the champions/i });
    fireEvent.click(joinButton);

    expect(await screen.findByText(/could not join the group/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
