// ingestTournament's failure handling (this session's brief, task 3): "on
// timeout, malformed response, or partial data from the upstream API, log
// the failure and keep serving the last good live_state rather than
// throwing/erroring the ingestion pipeline." Each test below seeds a good
// live_state via ManualProvider (mirroring ingest.test.ts's setup), then
// runs ingestTournament again with a CricketDataProvider wired to fail in
// one specific way, and asserts:
//   1. the existing live_state row is left byte-for-byte untouched
//   2. no exception propagates out of ingestTournament itself
// All three drive CricketDataProvider through an injected fetchImpl and
// recorded fixtures — never a real network call.

import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { group, liveState, tournament, user } from "@/lib/db/schema";
import { ManualProvider } from "@/lib/providers/manual-provider";
import { saveManualStandings } from "@/lib/providers/manual-input";
import { CricketDataProvider, type FetchLike } from "@/lib/providers/cricketdata-provider";
import { ingestTournament } from "@/lib/providers/ingest";
import { cleanupSeasonFixtures, insertTestTournament } from "@/lib/seasons/test-support";
import seriesPointsMissingFieldsFixture from "@/lib/providers/__fixtures__/cricketdata-series-points-missing-fields.json";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
  await db.delete(group).where(inArray(group.id, createdGroupIds));
  await db.delete(user).where(inArray(user.id, createdUserIds));
  await db.delete(tournament).where(inArray(tournament.id, createdTournamentIds));
});

async function seedGoodLiveState(): Promise<string> {
  const tournamentId = await insertTestTournament(createdTournamentIds, { providerKey: "series-123" });
  await saveManualStandings(
    db,
    {
      tournamentId,
      tableData: [{ teamId: "mi", played: 5, won: 4, lost: 1, points: 8, nrr: 0.5, position: 1 }],
      statLeaders: { runs: [{ playerId: "player-1", value: 300 }] },
      updatedBy: "test-admin",
    },
    new Date("2026-04-01T00:00:00.000Z")
  );
  const result = await ingestTournament(db, new ManualProvider(db), tournamentId, new Date("2026-04-01T00:05:00.000Z"));
  expect(result.liveState.source).toBe("manual");
  return tournamentId;
}

async function assertLiveStateUntouched(tournamentId: string, expectedFetchedAt: string): Promise<void> {
  const [row] = await db.select().from(liveState).where(eq(liveState.tournamentId, tournamentId));
  expect(row?.source).toBe("manual");
  expect(row?.fetchedAt.toISOString()).toBe(expectedFetchedAt);
  expect(row?.tableData).toEqual([{ teamId: "mi", played: 5, won: 4, lost: 1, points: 8, nrr: 0.5, position: 1 }]);
}

describe("ingestTournament — provider failure keeps last good live_state", () => {
  it("a timeout from the upstream provider leaves live_state untouched and does not throw", async () => {
    const tournamentId = await seedGoodLiveState();

    const neverResolvingFetch: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    const failingProvider = new CricketDataProvider(db, {
      apiKey: "test-key",
      fetchImpl: neverResolvingFetch,
      timeoutMs: 10,
    });

    const result = await ingestTournament(db, failingProvider, tournamentId, new Date("2026-04-01T01:00:00.000Z"));

    expect(result.liveState.source).toBe("manual");
    expect(result.recomputedSnapshots).toEqual([]);
    await assertLiveStateUntouched(tournamentId, "2026-04-01T00:05:00.000Z");
  });

  it("a malformed (non-JSON) response leaves live_state untouched and does not throw", async () => {
    const tournamentId = await seedGoodLiveState();

    const malformedJsonFetch: FetchLike = async () =>
      new Response("not json at all", { status: 200, headers: { "content-type": "text/plain" } });
    const failingProvider = new CricketDataProvider(db, { apiKey: "test-key", fetchImpl: malformedJsonFetch });

    const result = await ingestTournament(db, failingProvider, tournamentId, new Date("2026-04-01T01:00:00.000Z"));

    expect(result.liveState.source).toBe("manual");
    expect(result.recomputedSnapshots).toEqual([]);
    await assertLiveStateUntouched(tournamentId, "2026-04-01T00:05:00.000Z");
  });

  it("a response missing fields the mapping needs leaves live_state untouched and does not throw", async () => {
    const tournamentId = await seedGoodLiveState();

    const missingFieldsFetch: FetchLike = async () =>
      new Response(JSON.stringify(seriesPointsMissingFieldsFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const failingProvider = new CricketDataProvider(db, { apiKey: "test-key", fetchImpl: missingFieldsFetch });

    const result = await ingestTournament(db, failingProvider, tournamentId, new Date("2026-04-01T01:00:00.000Z"));

    expect(result.liveState.source).toBe("manual");
    expect(result.recomputedSnapshots).toEqual([]);
    await assertLiveStateUntouched(tournamentId, "2026-04-01T00:05:00.000Z");
  });
});
