// Integration tests for POST /api/seasons/:id/questions — both the
// template-shaped add path and the custom question builder (this session's
// brief, task 4: "the fallback that makes everything else optional").

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../lib/db/client";
import { question, season } from "../../../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../../../lib/auth/session";
import { createSeason } from "../../../../lib/seasons/service";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../../lib/seasons/test-support";
import handler from "./index";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function addQuestionRequest(seasonId: string, rawToken: string | null, body: unknown): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/questions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/seasons/:id/questions", () => {
  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(
      addQuestionRequest(created.id, fixture.memberSessionToken, {
        type: "champion",
        prompt: "Who wins?",
        config: {},
        points: 25,
      })
    );
    expect(response.status).toBe(403);
  });

  it("lets the admin add a template question to a draft season", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(
      addQuestionRequest(created.id, fixture.adminSessionToken, {
        type: "stat_leader",
        prompt: "Who wins the Purple Cap?",
        config: { statCategory: "wickets" },
        points: 15,
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { type: string; sortOrder: number; settlement: string };
    expect(body.type).toBe("stat_leader");
    expect(body.settlement).toBe("auto");
    expect(body.sortOrder).toBe(1);
  });

  it("the custom question builder: admin defines an arbitrary multiple-choice question", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(
      addQuestionRequest(created.id, fixture.adminSessionToken, {
        type: "custom",
        prompt: "Which player gets injured first?",
        config: {
          options: [
            { id: "player-a", label: "Player A" },
            { id: "player-b", label: "Player B" },
            { id: "player-c", label: "Player C" },
          ],
        },
        points: 10,
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      id: string;
      type: string;
      settlement: string;
      config: { options: { id: string; label: string }[] };
    };
    expect(body.type).toBe("custom");
    expect(body.settlement).toBe("manual");
    expect(body.config.options).toHaveLength(3);

    // Structurally exactly what src/lib/scoring/resolvers/custom.ts's
    // configOptionIds() reads: question.config.options[].id.
    const [row] = await db.select().from(question).where(eq(question.id, body.id));
    expect(row?.type).toBe("custom");
    expect((row?.config.options as { id: string }[])[0]?.id).toBe("player-a");
  });

  it("rejects a custom question with fewer than 2 options, with 400", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });

    const response = await handler(
      addQuestionRequest(created.id, fixture.adminSessionToken, {
        type: "custom",
        prompt: "Pointless question",
        config: { options: [{ id: "only", label: "Only option" }] },
        points: 10,
      })
    );
    expect(response.status).toBe(400);
  });

  it("rejects adding a question once the season is locked, with 409", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const created = await createSeason(db, { groupId: fixture.groupId, tournamentId, questions: [] });
    await db
      .update(season)
      .set({ status: "open", lockAt: new Date(Date.now() - 60_000) })
      .where(eq(season.id, created.id));

    const response = await handler(
      addQuestionRequest(created.id, fixture.adminSessionToken, {
        type: "champion",
        prompt: "Who wins?",
        config: {},
        points: 25,
      })
    );
    expect(response.status).toBe(409);
  });
});
