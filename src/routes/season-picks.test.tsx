// This session's bug fix: team-based questions (champion, runner_up,
// wooden_spoon, top_n_unordered, top_n_ordered) used to collect a free-typed
// team name/abbreviation ("RCB") that was never a real team.id, so it always
// failed src/lib/picks/service.ts's per-resolver validate() against
// Tournament.teamIds. This asserts the pick sheet now renders a dropdown
// populated from the season's real team catalogue (season.teams, added to
// GET /api/seasons/:id's response) and that choosing an option stores the
// team's real id — never its display name — in the PUT /api/seasons/:id/picks
// payload. Mocking pattern mirrors src/routes/season-new.test.tsx.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import "@testing-library/jest-dom/vitest";

const useSessionMock = vi.fn();
const fetchSeasonDetailMock = vi.fn();
const fetchMyPicksMock = vi.fn();
const putPicksMock = vi.fn();

vi.mock("@/lib/session/use-session", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("@/lib/seasons/client", () => ({
  fetchSeasonDetail: (seasonId: string) => fetchSeasonDetailMock(seasonId),
}));

vi.mock("@/lib/picks/client", () => ({
  fetchMyPicks: (seasonId: string) => fetchMyPicksMock(seasonId),
  putPicks: (seasonId: string, body: unknown) => putPicksMock(seasonId, body),
}));

const { default: SeasonPicksPage } = await import("./season-picks");

// Radix's Select relies on pointer-capture APIs jsdom doesn't implement.
// These are the standard test-only stand-ins (jsdom itself never runs a
// real pointer/layout engine, so these are inert no-ops, not behavior under
// test) — same pattern as Radix's own test suite.
beforeAllPolyfills();
function beforeAllPolyfills() {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

const TEAMS = [
  { id: "team-csk", name: "Chennai Super Kings", shortName: "CSK" },
  { id: "team-rcb", name: "Royal Challengers Bengaluru", shortName: "RCB" },
  { id: "team-mi", name: "Mumbai Indians", shortName: "MI" },
];

function seasonDetail(overrides?: { questions?: unknown[] }) {
  return {
    season: {
      id: "season-1",
      groupId: "group-1",
      tournamentId: "ipl-2026",
      name: "IPL 2026",
      lockAt: "2999-01-01T00:00:00.000Z",
      status: "open",
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
    ],
    teams: TEAMS,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/groups/group-1/seasons/season-1/picks"]}>
      <Routes>
        <Route path="/groups/:groupId/seasons/:seasonId/picks" element={<SeasonPicksPage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SeasonPicksPage team dropdown", () => {
  it("renders a dropdown populated from the season's real teams, not a free-text box", async () => {
    useSessionMock.mockReturnValue({ status: "signed-in" });
    fetchSeasonDetailMock.mockResolvedValue(seasonDetail());
    fetchMyPicksMock.mockResolvedValue({ picks: [] });

    renderPage();

    expect(await screen.findByText(/who wins it all\?/i)).toBeInTheDocument();
    // No free-text "Team ID" box left anywhere on the champion question.
    expect(screen.queryByPlaceholderText(/team id/i)).not.toBeInTheDocument();

    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);

    expect(await screen.findByText("Royal Challengers Bengaluru (RCB)")).toBeInTheDocument();
    expect(screen.getByText("Chennai Super Kings (CSK)")).toBeInTheDocument();
    expect(screen.getByText("Mumbai Indians (MI)")).toBeInTheDocument();
  });

  it("stores the team's real id, not its display name, when a team is selected", async () => {
    useSessionMock.mockReturnValue({ status: "signed-in" });
    fetchSeasonDetailMock.mockResolvedValue(seasonDetail());
    fetchMyPicksMock.mockResolvedValue({ picks: [] });
    putPicksMock.mockResolvedValue({ picks: [] });

    renderPage();
    expect(await screen.findByText(/who wins it all\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox"));
    const option = await screen.findByText("Royal Challengers Bengaluru (RCB)");
    fireEvent.click(option);

    // The trigger now reflects the chosen team...
    expect(await screen.findByText("Royal Challengers Bengaluru (RCB)")).toBeInTheDocument();

    // ...and the autosaved PUT payload carries the real teamId ("team-rcb"),
    // never the free-typed abbreviation a user might have recognized it by.
    await waitFor(() => expect(putPicksMock).toHaveBeenCalled(), { timeout: 2000 });
    const [seasonIdArg, body] = putPicksMock.mock.calls[0] as [string, { picks: { questionId: string; answer: { teamId?: string } }[] }];
    expect(seasonIdArg).toBe("season-1");
    expect(body.picks[0]?.questionId).toBe("q-champion");
    expect(body.picks[0]?.answer.teamId).toBe("team-rcb");
  });

  it("excludes an already-picked team from a sibling top-N slot's options", async () => {
    useSessionMock.mockReturnValue({ status: "signed-in" });
    fetchSeasonDetailMock.mockResolvedValue(
      seasonDetail({
        questions: [
          {
            id: "q-top2",
            seasonId: "season-1",
            type: "top_n_unordered",
            prompt: "Pick the top 2 teams",
            config: { n: 2 },
            points: 10,
            sortOrder: 1,
            settlement: "auto",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      })
    );
    fetchMyPicksMock.mockResolvedValue({ picks: [] });

    renderPage();
    expect(await screen.findByText(/pick the top 2 teams/i)).toBeInTheDocument();

    const [firstSlot, secondSlot] = screen.getAllByRole("combobox");
    fireEvent.click(firstSlot);
    fireEvent.click(await screen.findByText("Royal Challengers Bengaluru (RCB)"));

    fireEvent.click(secondSlot);
    // RCB was taken by slot 1, so slot 2's own open listbox must not offer
    // it again (scoped to the listbox — slot 1's trigger still legitimately
    // displays "RCB" as its own chosen value).
    const listbox = await screen.findByRole("listbox");
    await within(listbox).findByText("Chennai Super Kings (CSK)");
    expect(within(listbox).queryByText("Royal Challengers Bengaluru (RCB)")).not.toBeInTheDocument();
  });
});
