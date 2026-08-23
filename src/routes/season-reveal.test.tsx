// This session's bug fix: the reveal page used to dump raw database values —
// a team's raw `teamId` (a hex createId()) for team-based questions, and a
// custom question's raw `optionId` (e.g. "option-1") for `custom` questions —
// straight into the UI with zero resolution to anything human-readable. This
// asserts the reveal page now resolves both to their real, human labels via
// `season.teams` and `question.config.options`, and that a known IPL
// franchise gets its real brand color while an unrecognized team name still
// falls back to the existing hash-based identity color system. Mocking
// pattern mirrors src/routes/season-picks.test.tsx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import "@testing-library/jest-dom/vitest";
import { franchiseColorFor, identityColorFor } from "@/lib/design/identity-colors";
import type { SeasonDetailResponse } from "@/lib/schemas/seasons";

const useSessionMock = vi.fn();
const fetchSeasonDetailMock = vi.fn();
const fetchAllPicksMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/lib/session/use-session", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("@/lib/seasons/client", () => ({
  fetchSeasonDetail: (seasonId: string) => fetchSeasonDetailMock(seasonId),
}));

vi.mock("@/lib/picks/client", () => ({
  fetchAllPicks: (seasonId: string) => fetchAllPicksMock(seasonId),
}));

vi.mock("@/lib/cards/client", () => ({
  buildCardUrl: () => "https://example.com/card.png",
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

const { default: SeasonRevealPage, buildMemberShareText } = await import("./season-reveal");

const TEAMS = [
  { id: "team-csk-hex", name: "Chennai Super Kings", shortName: "CSK" },
  { id: "team-rcb-hex", name: "Royal Challengers Bengaluru", shortName: "RCB" },
  { id: "team-unknown-hex", name: "Some Local XI", shortName: "SLX" },
];

function seasonDetail(overrides?: { questions?: SeasonDetailResponse["questions"] }): SeasonDetailResponse {
  return {
    season: {
      id: "season-1",
      groupId: "group-1",
      tournamentId: "ipl-2026",
      name: "IPL 2026",
      lockAt: "2020-01-01T00:00:00.000Z",
      status: "locked",
      scoringConfig: { boldPickEnabled: true, injuryRule: "zero" },
      createdAt: "2026-01-01T00:00:00.000Z",
      settledAt: null,
      voidedAt: null,
      voidReason: null,
    },
    questions: overrides?.questions ?? [
      {
        id: "q-champion",
        seasonId: "season-1",
        type: "champion",
        prompt: "Who wins it all?",
        config: {},
        points: 10,
        sortOrder: 1,
        settlement: "auto",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "q-custom",
        seasonId: "season-1",
        type: "custom",
        prompt: "Who has the best haircut?",
        config: {
          options: [
            { id: "option-1", label: "The captain, obviously" },
            { id: "option-2", label: "Nobody, everyone's a mess" },
          ],
        },
        points: 5,
        sortOrder: 2,
        settlement: "manual",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    teams: TEAMS,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/groups/group-1/seasons/season-1/reveal"]}>
      <Routes>
        <Route path="/groups/:groupId/seasons/:seasonId/reveal" element={<SeasonRevealPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useSessionMock.mockReturnValue({ status: "signed-in" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SeasonRevealPage answer resolution", () => {
  it("renders a team-based answer's real team name, not the raw teamId", async () => {
    fetchSeasonDetailMock.mockResolvedValue(seasonDetail());
    fetchAllPicksMock.mockResolvedValue({
      members: [
        {
          memberId: "member-1",
          userId: "user-1",
          displayName: "Ada",
          picks: [
            {
              id: "pick-1",
              questionId: "q-champion",
              answer: { teamId: "team-rcb-hex" },
              submittedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("Royal Challengers Bengaluru")).toBeInTheDocument();
    expect(screen.queryByText("team-rcb-hex")).not.toBeInTheDocument();
  });

  it("renders a custom question's real option label, not the raw optionId", async () => {
    fetchSeasonDetailMock.mockResolvedValue(seasonDetail());
    fetchAllPicksMock.mockResolvedValue({
      members: [
        {
          memberId: "member-1",
          userId: "user-1",
          displayName: "Ada",
          picks: [
            {
              id: "pick-2",
              questionId: "q-custom",
              answer: { optionId: "option-2" },
              submittedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("Nobody, everyone's a mess")).toBeInTheDocument();
    expect(screen.queryByText("option-2")).not.toBeInTheDocument();
  });

  it("falls back to the raw id if a team somehow can't be resolved (defensive path)", async () => {
    fetchSeasonDetailMock.mockResolvedValue(seasonDetail());
    fetchAllPicksMock.mockResolvedValue({
      members: [
        {
          memberId: "member-1",
          userId: "user-1",
          displayName: "Ada",
          picks: [
            {
              id: "pick-3",
              questionId: "q-champion",
              answer: { teamId: "team-not-in-roster" },
              submittedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    renderPage();

    expect(await screen.findByText("team-not-in-roster")).toBeInTheDocument();
  });
});

describe("SeasonRevealPage IPL brand colors", () => {
  it("assigns Chennai Super Kings their real brand color, not a hashed fallback", () => {
    const franchise = franchiseColorFor("Chennai Super Kings");
    expect(franchise).toBeDefined();
    // CSK's real brand color is yellow/gold, not any of the hash palette's
    // fixed hues, and case-insensitive lookup matches how the reveal page
    // passes the team's stored name straight through.
    expect(franchiseColorFor("chennai super kings")).toEqual(franchise);
    expect(franchise?.dark.background.toLowerCase()).toBe("#fdb913");
  });

  it("falls back to the existing hash-based color system for a non-IPL team name", () => {
    const seed = "Some Local XI";
    expect(franchiseColorFor(seed)).toBeUndefined();
    expect(identityColorFor(seed)).toBeDefined();
  });
});

// This session's brief: a small per-member share icon in each member card's
// header, distinct from the page's whole-season <ShareCardButton>. Builds
// its text from the same real-name resolution the on-screen slate already
// uses (season-reveal.test.tsx's answer-resolution describe block above),
// so these assert both the text-building function directly and the button's
// wiring to navigator.share / the clipboard fallback.
describe("SeasonRevealPage per-member share button", () => {
  const member = {
    memberId: "member-1",
    userId: "user-1",
    displayName: "Ada",
    picks: [
      {
        id: "pick-1",
        questionId: "q-champion",
        answer: { teamId: "team-rcb-hex" },
        submittedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "pick-2",
        questionId: "q-custom",
        answer: { optionId: "option-2" },
        submittedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };

  it("builds a text summary from real resolved answers, not raw ids", () => {
    const text = buildMemberShareText(member, seasonDetail());

    expect(text).toContain("Ada's picks for IPL 2026:");
    expect(text).toContain("Who wins it all?: Royal Challengers Bengaluru");
    expect(text).toContain("Who has the best haircut?: Nobody, everyone's a mess");
    expect(text).not.toContain("team-rcb-hex");
    expect(text).not.toContain("option-2");
  });

  it("says 'No pick' for a question the member left blank", () => {
    const text = buildMemberShareText(
      { ...member, picks: [member.picks[0]] },
      seasonDetail()
    );
    expect(text).toContain("Who has the best haircut?: No pick");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls navigator.share with the resolved text and the reveal page's URL when available", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share: shareMock });

    fetchSeasonDetailMock.mockResolvedValue(seasonDetail());
    fetchAllPicksMock.mockResolvedValue({ members: [member] });

    renderPage();

    const shareButton = await screen.findByRole("button", { name: "Share Ada's picks" });
    fireEvent.click(shareButton);

    await vi.waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    const call = shareMock.mock.calls[0][0] as { title: string; text: string; url: string };
    expect(call.text).toContain("Royal Challengers Bengaluru");
    expect(call.text).not.toContain("team-rcb-hex");
    expect(typeof call.url).toBe("string");
  });

  it("does not surface an error when the user dismisses the native share sheet (AbortError)", async () => {
    const abortError = new DOMException("dismissed", "AbortError");
    const shareMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("navigator", { ...navigator, share: shareMock });

    fetchSeasonDetailMock.mockResolvedValue(seasonDetail());
    fetchAllPicksMock.mockResolvedValue({ members: [member] });

    renderPage();

    const shareButton = await screen.findByRole("button", { name: "Share Ada's picks" });
    fireEvent.click(shareButton);

    await vi.waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard with a success toast when the Web Share API is unavailable", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    // Spread everything but `share`, so `typeof navigator.share === "function"`
    // is false — the same "API doesn't exist" branch a real desktop browser
    // without Web Share support would hit.
    const { share: _share, ...navigatorWithoutShare } = navigator;
    vi.stubGlobal("navigator", { ...navigatorWithoutShare, clipboard: { writeText: writeTextMock } });

    fetchSeasonDetailMock.mockResolvedValue(seasonDetail());
    fetchAllPicksMock.mockResolvedValue({ members: [member] });

    renderPage();

    const shareButton = await screen.findByRole("button", { name: "Share Ada's picks" });
    fireEvent.click(shareButton);

    await vi.waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    const [copiedText] = writeTextMock.mock.calls[0] as [string];
    expect(copiedText).toContain("Royal Challengers Bengaluru");
    expect(copiedText).not.toContain("team-rcb-hex");
    await vi.waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
  });
});
