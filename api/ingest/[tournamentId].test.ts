// POST /api/ingest/:tournamentId — doc 03 §3.7 [Bearer INGEST_SECRET].
// Proves the constant-time secret check gates the route (401 on
// missing/wrong secret, success on the right one) and that a real call
// writes live_state and recomputes every active season on the tournament.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { liveState, season } from "@/lib/db/schema";
import { createSeason } from "@/lib/seasons/service";
import { saveManualStandings } from "@/lib/providers/manual-input";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "@/lib/seasons/test-support";
import handler from "./[tournamentId]";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];
const originalIngestSecret = process.env.INGEST_SECRET;

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
  process.env.INGEST_SECRET = originalIngestSecret;
});

function ingestRequest(tournamentId: string, authHeader: string | null): Request {
  return new Request(`http://localhost/api/ingest/${tournamentId}`, {
    method: "POST",
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

async function makeOpenSeasonWithManualInput(): Promise<{ tournamentId: string; seasonId: string }> {
  const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
  const tournamentId = await insertTestTournament(createdTournamentIds);
  const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
  await db.update(season).set({ status: "open" }).where(eq(season.id, created.id));
  await saveManualStandings(
    db,
    {
      tournamentId,
      tableData: [{ teamId: "mi", played: 2, won: 1, lost: 1, points: 2, nrr: 0.1, position: 1 }],
      statLeaders: {},
      updatedBy: fixture.adminUserId,
    },
    new Date("2026-04-01T00:00:00.000Z")
  );
  return { tournamentId, seasonId: created.id };
}

describe("POST /api/ingest/:tournamentId", () => {
  it("rejects a request with no Authorization header with 401", async () => {
    process.env.INGEST_SECRET = "test-ingest-secret";
    const { tournamentId } = await makeOpenSeasonWithManualInput();
    const response = await handler(ingestRequest(tournamentId, null));
    expect(response.status).toBe(401);
  });

  it("rejects the wrong secret with 401", async () => {
    process.env.INGEST_SECRET = "test-ingest-secret";
    const { tournamentId } = await makeOpenSeasonWithManualInput();
    const response = await handler(ingestRequest(tournamentId, "Bearer not-the-secret"));
    expect(response.status).toBe(401);
  });

  it("accepts the exact configured secret and ingests", async () => {
    process.env.INGEST_SECRET = "test-ingest-secret";
    const { tournamentId, seasonId } = await makeOpenSeasonWithManualInput();

    const response = await handler(ingestRequest(tournamentId, "Bearer test-ingest-secret"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { tournamentId: string; recomputedSeasonIds: string[] };
    expect(body.tournamentId).toBe(tournamentId);
    expect(body.recomputedSeasonIds).toEqual([seasonId]);

    const [row] = await db.select().from(liveState).where(eq(liveState.tournamentId, tournamentId));
    expect(row?.source).toBe("manual");
  });
});
