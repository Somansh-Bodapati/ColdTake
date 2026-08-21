// Integration test for POST /api/seasons/:id/questions/:qid/settle — the
// business logic itself is covered thoroughly by
// src/lib/seasons/settlement.test.ts; this just proves the route is wired
// correctly (admin gate, path parameter parsing, request validation,
// response shape).

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../../lib/db/client";
import { question, season } from "../../../../../lib/db/schema";
import { SESSION_COOKIE_NAME } from "../../../../../lib/auth/session";
import { createSeason } from "../../../../../lib/seasons/service";
import { settleSeason } from "../../../../../lib/seasons/settlement";
import { ManualProvider } from "../../../../../lib/providers/manual-provider";
import { saveManualStandings } from "../../../../../lib/providers/manual-input";
import {
  cleanupSeasonFixtures,
  insertTestTeams,
  insertTestTournament,
  makeGroupWithAdminAndMember,
} from "../../../../../lib/seasons/test-support";
import handler from "./settle";

const createdUserIds: string[] = [];
const createdGroupIds: string[] = [];
const createdTournamentIds: string[] = [];

afterEach(async () => {
  await cleanupSeasonFixtures(createdGroupIds, createdUserIds, createdTournamentIds);
});

function settleQuestionRequest(
  seasonId: string,
  questionId: string,
  rawToken: string | null,
  body: unknown
): Request {
  return new Request(`http://localhost/api/seasons/${seasonId}/questions/${questionId}/settle`, {
    method: "POST",
    headers: {
      ...(rawToken ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function settledBooleanFixture() {
  const fixture = await makeGroupWithAdminAndMember(createdUserIds, createdGroupIds);
  const tournamentId = await insertTestTournament(createdTournamentIds);
  const teamIds = await insertTestTeams(tournamentId, ["mi"]);
  const created = await createSeason(db, {
    groupId: fixture.groupId,
    tournamentId,
    questions: [
      { type: "boolean", prompt: "Any Super Over?", config: {}, points: 10, settlement: "manual" },
    ],
  });
  await db.update(season).set({ status: "locked" }).where(eq(season.id, created.id));
  await saveManualStandings(
    db,
    {
      tournamentId,
      tableData: [{ teamId: teamIds.mi!, played: 1, won: 1, lost: 0, points: 2, nrr: 1, position: 1 }],
      statLeaders: {},
      updatedBy: fixture.adminUserId,
    },
    new Date()
  );
  await settleSeason(db, created.id, new ManualProvider(db), fixture.adminUserId, new Date());
  const [questionRow] = await db.select().from(question).where(eq(question.seasonId, created.id));
  return { fixture, created, questionRow: questionRow! };
}

describe("POST /api/seasons/:id/questions/:qid/settle", () => {
  it("rejects a non-admin member with 403", async () => {
    const { fixture, created, questionRow } = await settledBooleanFixture();

    const response = await handler(
      settleQuestionRequest(created.id, questionRow.id, fixture.memberSessionToken, {
        answer: { bool: true },
      })
    );
    expect(response.status).toBe(403);
  });

  it("settles a manual (boolean) question and returns the updated standings", async () => {
    const { fixture, created, questionRow } = await settledBooleanFixture();

    const response = await handler(
      settleQuestionRequest(created.id, questionRow.id, fixture.adminSessionToken, {
        answer: { bool: true },
      })
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.questionResult.source).toBe("manual");
    expect(body.questionResult.answer).toEqual({ bool: true });
    expect(body.standings.isProjected).toBe(false);
  });

  // doc 01 §4.3: "Data source disagrees with reality — Admin override on any
  // settled question, with an audit note."
  it("rejects an override with no note, and accepts one with a note", async () => {
    const { fixture, created, questionRow } = await settledBooleanFixture();
    await handler(
      settleQuestionRequest(created.id, questionRow.id, fixture.adminSessionToken, {
        answer: { bool: true },
      })
    );

    const noNote = await handler(
      settleQuestionRequest(created.id, questionRow.id, fixture.adminSessionToken, {
        answer: { bool: false },
      })
    );
    expect(noNote.status).toBe(400);

    const withNote = await handler(
      settleQuestionRequest(created.id, questionRow.id, fixture.adminSessionToken, {
        answer: { bool: false },
        note: "Scorecard was corrected by the league after review",
      })
    );
    expect(withNote.status).toBe(201);
    const body = await withNote.json();
    expect(body.questionResult.source).toBe("override");
    expect(body.questionResult.note).toMatch(/corrected/);
  });
});
