// Integration tests against local Postgres — same pattern as
// api/groups/[id]/transfer.test.ts. Proves the group-admin authorization
// requirement (this session's brief, task 6) and the doc 01 §2.3/§4.1
// default-template flow end to end through the real POST /api/seasons route.

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../lib/db/client";
import { question, season } from "../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../lib/auth/session";
import { buildDefaultQuestionTemplates } from "../../lib/seasons/templates";
import {
  cleanupSeasonFixtures,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../lib/seasons/test-support";
import handler from "./index";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function createSeasonRequest(rawToken: string | null, body: unknown): Request {
  return new Request("http://localhost/api/seasons", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/seasons", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const response = await handler(createSeasonRequest(null, {}));
    expect(response.status).toBe(401);
  });

  it("rejects a non-admin member with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);

    const response = await handler(
      createSeasonRequest(fixture.memberSessionToken, {
        groupId: fixture.groupId,
        tournamentId,
        questions: [],
      })
    );
    expect(response.status).toBe(403);
  });

  it("rejects an outsider (not a member at all) with 403", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);

    const response = await handler(
      createSeasonRequest(fixture.outsiderSessionToken, {
        groupId: fixture.groupId,
        tournamentId,
        questions: [],
      })
    );
    expect(response.status).toBe(403);
  });

  it("lets the admin create a draft season, deriving name/lockAt from the tournament", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds, {
      startsAt: new Date("2026-04-01T10:00:00.000Z"),
    });

    const response = await handler(
      createSeasonRequest(fixture.adminSessionToken, {
        groupId: fixture.groupId,
        tournamentId,
        questions: [],
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { season: { id: string; status: string; name: string; lockAt: string } };
    expect(body.season.status).toBe("draft");
    expect(body.season.name).toBe("TT 2026");
    expect(body.season.lockAt).toBe("2026-04-01T10:00:00.000Z");

    const [row] = await db.select().from(season).where(eq(season.id, body.season.id));
    expect(row?.status).toBe("draft");
  });

  it("pre-populates the default question template set (doc 01 §2.3/§4.1)", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);
    const templates = buildDefaultQuestionTemplates({
      shortName: "TT 2026",
      config: { statCategories: ["runs", "wickets", "sixes"] },
    }).filter((t) => t.preChecked);

    const response = await handler(
      createSeasonRequest(fixture.adminSessionToken, {
        groupId: fixture.groupId,
        tournamentId,
        questions: templates.map((t) => ({
          type: t.type,
          prompt: t.prompt,
          config: t.config,
          points: t.points,
          settlement: t.settlement,
        })),
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { questions: Array<{ type: string }> };
    expect(body.questions).toHaveLength(templates.length);
    expect(body.questions.map((q) => q.type)).toEqual(expect.arrayContaining(["champion", "wooden_spoon"]));
  });

  it("accepts a custom multiple-choice question at creation time", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);

    const response = await handler(
      createSeasonRequest(fixture.adminSessionToken, {
        groupId: fixture.groupId,
        tournamentId,
        questions: [
          {
            type: "custom",
            prompt: "Who wears the funniest hat this season?",
            config: {
              options: [
                { id: "priya", label: "Priya" },
                { id: "arjun", label: "Arjun" },
              ],
            },
            points: 10,
          },
        ],
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      season: { id: string };
      questions: Array<{ type: string; config: { options?: unknown[] } }>;
    };
    expect(body.questions[0]?.type).toBe("custom");
    expect(body.questions[0]?.config.options).toHaveLength(2);

    const rows = await db.select().from(question).where(eq(question.seasonId, body.season.id));
    expect(rows[0]?.type).toBe("custom");
    expect(rows[0]?.settlement).toBe("manual");
  });

  it("rejects a second season for the same group+tournament with 409", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);

    const first = await handler(
      createSeasonRequest(fixture.adminSessionToken, { groupId: fixture.groupId, tournamentId, questions: [] })
    );
    expect(first.status).toBe(201);

    const second = await handler(
      createSeasonRequest(fixture.adminSessionToken, { groupId: fixture.groupId, tournamentId, questions: [] })
    );
    expect(second.status).toBe(409);
  });

  it("rejects a malformed body (bad config for the type) with 400", async () => {
    const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
    const tournamentId = await insertTestTournament(createdTournamentIds);

    const response = await handler(
      createSeasonRequest(fixture.adminSessionToken, {
        groupId: fixture.groupId,
        tournamentId,
        questions: [{ type: "top_n_unordered", prompt: "Top 4?", config: {}, points: 20 }],
      })
    );
    expect(response.status).toBe(400);
  });
});
