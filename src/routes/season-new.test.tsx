// Bug fixes (tonight):
//  1. Publish failures used to surface only via an inline <p> below the
//     fold — now a toast (sonner), asserted here via a mocked "sonner"
//     module so this doesn't depend on the Toaster actually being mounted.
//  2. The lock time was only settable once, before the season existed, and
//     was never shown again — this asserts isLockAtInFuture (the client-side
//     guard behind the "Save lock time" button and the publish button) and
//     that the edit flow loads an existing draft's lockAt into the field.
//  3. season-new.tsx used to only support creating a brand new season —
//     this asserts it also loads an existing draft when the route carries a
//     :seasonId (the new /groups/:groupId/seasons/:seasonId/edit route in
//     src/routes.ts, linked from group.tsx's draft-season entries).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import "@testing-library/jest-dom/vitest";

const useSessionMock = vi.fn();
const useUserMock = vi.fn();
const fetchGroupDetailMock = vi.fn();
const fetchSeasonDetailMock = vi.fn();
const fetchTournamentCatalogueMock = vi.fn();
const publishSeasonMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/session/use-session", () => ({
  useSession: () => useSessionMock(),
  useUser: () => useUserMock(),
}));

vi.mock("@/lib/groups/client", () => ({
  fetchGroupDetail: (groupId: string) => fetchGroupDetailMock(groupId),
}));

vi.mock("@/lib/seasons/client", () => ({
  fetchGroupDetail: fetchGroupDetailMock,
  fetchSeasonDetail: (seasonId: string) => fetchSeasonDetailMock(seasonId),
  fetchTournamentCatalogue: () => fetchTournamentCatalogueMock(),
  createSeason: vi.fn(),
  addQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  publishSeason: (seasonId: string) => publishSeasonMock(seasonId),
  updateSeason: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

const { default: SeasonNewPage, isLockAtInFuture } = await import("./season-new");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("isLockAtInFuture", () => {
  it("is false for a past datetime-local value", () => {
    expect(isLockAtInFuture("2020-01-01T00:00")).toBe(false);
  });

  it("is true for a datetime-local value far in the future", () => {
    expect(isLockAtInFuture("2999-01-01T00:00")).toBe(true);
  });

  it("is false for an unparseable value", () => {
    expect(isLockAtInFuture("not-a-date")).toBe(false);
  });
});

function renderEditRoute(seasonId = "season-1", groupId = "group-1") {
  return render(
    <MemoryRouter initialEntries={[`/groups/${groupId}/seasons/${seasonId}/edit`]}>
      <Routes>
        <Route path="/groups/:groupId/seasons/:seasonId/edit" element={<SeasonNewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SeasonNewPage edit mode", () => {
  it("loads an existing draft season instead of the tournament-picker flow", async () => {
    useSessionMock.mockReturnValue({ status: "signed-in" });
    useUserMock.mockReturnValue({ id: "user-1" });
    fetchGroupDetailMock.mockResolvedValue({
      group: { id: "group-1", name: "FUNKIES", joinCode: "AB12CD" },
      members: [{ id: "m1", userId: "user-1", displayName: "Admin", role: "admin", joinedAt: "" }],
      seasons: [],
    });
    fetchSeasonDetailMock.mockResolvedValue({
      season: {
        id: "season-1",
        groupId: "group-1",
        tournamentId: "t1",
        name: "IPL 2026",
        lockAt: "2026-03-27T19:00:00.000Z",
        status: "draft",
        scoringConfig: { boldPickEnabled: true, injuryRule: "zero" },
        createdAt: "2026-01-01T00:00:00.000Z",
        settledAt: null,
        voidedAt: null,
        voidReason: null,
      },
      questions: [
        {
          id: "q1",
          seasonId: "season-1",
          type: "champion",
          prompt: "Who wins it all?",
          config: {},
          points: 10,
          sortOrder: 1,
          settlement: "auto",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    renderEditRoute();

    expect(await screen.findByText(/edit draft season/i)).toBeInTheDocument();
    expect(await screen.findByText(/who wins it all\?/i)).toBeInTheDocument();
    // Confirms bug 3's fix end-to-end: an existing draft loads via
    // fetchSeasonDetail, never through the tournament catalogue used by a
    // fresh create.
    expect(fetchSeasonDetailMock).toHaveBeenCalledWith("season-1");
    expect(fetchTournamentCatalogueMock).not.toHaveBeenCalled();

    // Bug 2's fix: the lock time is visible and pre-filled from the loaded
    // draft, not hidden or reset. Computed in the test's own local timezone
    // (same conversion season-new.tsx does) rather than hardcoded, so this
    // isn't flaky across machines/CI in a different timezone.
    const expected = new Date("2026-03-27T19:00:00.000Z");
    const pad = (n: number) => String(n).padStart(2, "0");
    const expectedLocalValue = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}T${pad(expected.getHours())}:${pad(expected.getMinutes())}`;
    const lockAtInput = screen.getByLabelText(/lock time/i) as HTMLInputElement;
    expect(lockAtInput.value).toBe(expectedLocalValue);
  });

  it("shows a toast (not a buried inline error) when publish fails", async () => {
    useSessionMock.mockReturnValue({ status: "signed-in" });
    useUserMock.mockReturnValue({ id: "user-1" });
    fetchGroupDetailMock.mockResolvedValue({
      group: { id: "group-1", name: "FUNKIES", joinCode: "AB12CD" },
      members: [{ id: "m1", userId: "user-1", displayName: "Admin", role: "admin", joinedAt: "" }],
      seasons: [],
    });
    fetchSeasonDetailMock.mockResolvedValue({
      season: {
        id: "season-1",
        groupId: "group-1",
        tournamentId: "t1",
        name: "IPL 2026",
        lockAt: "2026-03-27T19:00:00.000Z",
        status: "draft",
        scoringConfig: { boldPickEnabled: true, injuryRule: "zero" },
        createdAt: "2026-01-01T00:00:00.000Z",
        settledAt: null,
        voidedAt: null,
        voidReason: null,
      },
      questions: [
        {
          id: "q1",
          seasonId: "season-1",
          type: "champion",
          prompt: "Who wins it all?",
          config: {},
          points: 10,
          sortOrder: 1,
          settlement: "auto",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    publishSeasonMock.mockRejectedValue(
      new Error("A season needs at least one question and a lock time in the future to publish")
    );

    renderEditRoute();

    const publishButton = await screen.findByRole("button", { name: /publish season/i });
    publishButton.click();

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(toastErrorMock.mock.calls[0][0]).toMatch(/lock time in the future/i);
  });
});
