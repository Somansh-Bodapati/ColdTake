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
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import "@testing-library/jest-dom/vitest";
import { franchiseColorFor, identityColorFor } from "@/lib/design/identity-colors";

const useSessionMock = vi.fn();
const fetchSeasonDetailMock = vi.fn();
const fetchAllPicksMock = vi.fn();

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

const { default: SeasonRevealPage } = await import("./season-reveal");

const TEAMS = [
  { id: "team-csk-hex", name: "Chennai Super Kings", shortName: "CSK" },
  { id: "team-rcb-hex", name: "Royal Challengers Bengaluru", shortName: "RCB" },
  { id: "team-unknown-hex", name: "Some Local XI", shortName: "SLX" },
];

function seasonDetail(overrides?: { questions?: unknown[] }) {
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
