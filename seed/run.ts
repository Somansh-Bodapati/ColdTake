// Loads seed/*.json into the database pointed at by DATABASE_URL. Deletes
// existing rows first (in FK-safe order) so this is a one-command reset to
// a realistic dev state, not just a first-run insert (doc 03 §6: "being
// able to reset to a realistic state in one command will save you hours").
//
// Not run through src/lib/db/client.ts's driver-swap: seeding, like
// migrating, only ever happens from a trusted local/CI environment with a
// direct Postgres connection, so it talks to `pg` directly.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";
import type {
  AuthTokenPurpose,
  LiveStateStatLeaders,
  LiveStateTableRow,
  MemberRole,
  PickAnswer,
  QuestionConfig,
  QuestionType,
  ResultKind,
  ResultSource,
  SeasonScoringConfig,
  SeasonStatus,
  SettlementMode,
  StandingsEntry,
  TournamentConfig,
} from "../src/lib/db/schema";

const seedDir = path.dirname(fileURLToPath(import.meta.url));

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(seedDir, fileName), "utf-8")) as T;
}

interface TournamentFixture {
  tournament: {
    id: string;
    sport: "cricket";
    name: string;
    shortName: string;
    startsAt: string;
    endsAt: string;
    status: "upcoming" | "live" | "completed" | "abandoned";
    teamCount: number;
    providerKey: string;
    config: TournamentConfig;
  };
  teams: {
    id: string;
    shortName: string;
    name: string;
    color: string;
  }[];
  players: {
    id: string;
    teamId: string;
    name: string;
    role: string;
    providerKey: string;
  }[];
}

interface GroupFixture {
  users: {
    id: string;
    displayName: string;
    email: string | null;
    avatarSeed: string;
    claimedAt: string | null;
  }[];
  authTokens: {
    id: string;
    userId: string;
    tokenHash: string;
    purpose: AuthTokenPurpose;
    expiresAt: string;
    usedAt: string | null;
  }[];
  group: {
    id: string;
    name: string;
    slug: string;
    joinCode: string;
    createdBy: string;
    createdAt: string;
    archivedAt: string | null;
  };
  members: {
    id: string;
    userId: string;
    role: MemberRole;
    joinedAt: string;
  }[];
}

interface LiveStateFixture {
  tournamentId: string;
  tableData: LiveStateTableRow[];
  statLeaders: LiveStateStatLeaders;
  source: string;
  fetchedAt: string;
}

interface SeasonFixture {
  season: {
    id: string;
    groupId: string;
    tournamentId: string;
    name: string;
    lockAt: string;
    status: SeasonStatus;
    scoringConfig: SeasonScoringConfig;
    memberSnapshot: string[];
    createdAt: string;
    settledAt: string | null;
  };
  questions: {
    id: string;
    type: QuestionType;
    prompt: string;
    config: QuestionConfig;
    points: number;
    sortOrder: number;
    settlement: SettlementMode;
    createdAt: string;
  }[];
  picks: {
    id: string;
    questionId: string;
    memberId: string;
    answer: PickAnswer;
    submittedAt: string;
    updatedAt: string;
  }[];
  pickHistory: {
    id: number;
    pickId: string;
    answer: PickAnswer;
    recordedAt: string;
  }[];
  comments: {
    id: string;
    questionId: string | null;
    memberId: string;
    body: string;
    createdAt: string;
    deletedAt: string | null;
  }[];
  result: {
    id: string;
    tournamentId: string;
    kind: ResultKind;
    payload: Record<string, unknown>;
    source: ResultSource;
    isFinal: boolean;
    recordedAt: string;
    recordedBy: string | null;
  };
  standingsSnapshot: {
    id: number;
    seasonId: string;
    isProjected: boolean;
    standings: StandingsEntry[];
    computedAt: string;
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing required env var: DATABASE_URL");
  }

  const tournamentFixture = readJson<TournamentFixture>("tournament.json");
  const groupFixture = readJson<GroupFixture>("group.json");
  const liveStateFixture = readJson<LiveStateFixture>("live-state.json");
  const seasonFixture = readJson<SeasonFixture>("season.json");

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  console.log("Clearing existing rows...");
  // Reverse FK order.
  await db.delete(schema.comment);
  await db.delete(schema.standingsSnapshot);
  await db.delete(schema.pickHistory);
  await db.delete(schema.pick);
  await db.delete(schema.question);
  await db.delete(schema.result);
  await db.delete(schema.liveState);
  await db.delete(schema.season);
  await db.delete(schema.member);
  await db.delete(schema.group);
  await db.delete(schema.player);
  await db.delete(schema.team);
  await db.delete(schema.tournament);
  await db.delete(schema.authToken);
  await db.delete(schema.user);

  console.log("Seeding tournament catalogue...");
  await db.insert(schema.tournament).values({
    id: tournamentFixture.tournament.id,
    sport: tournamentFixture.tournament.sport,
    name: tournamentFixture.tournament.name,
    shortName: tournamentFixture.tournament.shortName,
    startsAt: new Date(tournamentFixture.tournament.startsAt),
    endsAt: new Date(tournamentFixture.tournament.endsAt),
    status: tournamentFixture.tournament.status,
    teamCount: tournamentFixture.tournament.teamCount,
    providerKey: tournamentFixture.tournament.providerKey,
    config: tournamentFixture.tournament.config,
  });

  await db.insert(schema.team).values(
    tournamentFixture.teams.map((team) => ({
      id: team.id,
      tournamentId: tournamentFixture.tournament.id,
      name: team.name,
      shortName: team.shortName,
      color: team.color,
    }))
  );

  await db.insert(schema.player).values(
    tournamentFixture.players.map((player) => ({
      id: player.id,
      tournamentId: tournamentFixture.tournament.id,
      teamId: player.teamId,
      name: player.name,
      role: player.role as schema.PlayerRole,
      providerKey: player.providerKey,
    }))
  );

  console.log("Seeding users, auth tokens, group, members...");
  await db.insert(schema.user).values(
    groupFixture.users.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarSeed: user.avatarSeed,
      claimedAt: user.claimedAt ? new Date(user.claimedAt) : null,
    }))
  );

  await db.insert(schema.authToken).values(
    groupFixture.authTokens.map((token) => ({
      id: token.id,
      userId: token.userId,
      tokenHash: token.tokenHash,
      purpose: token.purpose,
      expiresAt: new Date(token.expiresAt),
      usedAt: token.usedAt ? new Date(token.usedAt) : null,
    }))
  );

  await db.insert(schema.group).values({
    id: groupFixture.group.id,
    name: groupFixture.group.name,
    slug: groupFixture.group.slug,
    joinCode: groupFixture.group.joinCode,
    createdBy: groupFixture.group.createdBy,
    createdAt: new Date(groupFixture.group.createdAt),
    archivedAt: groupFixture.group.archivedAt
      ? new Date(groupFixture.group.archivedAt)
      : null,
  });

  await db.insert(schema.member).values(
    groupFixture.members.map((member) => ({
      id: member.id,
      groupId: groupFixture.group.id,
      userId: member.userId,
      role: member.role,
      joinedAt: new Date(member.joinedAt),
    }))
  );

  console.log("Seeding season, questions, picks, comments...");
  await db.insert(schema.season).values({
    id: seasonFixture.season.id,
    groupId: seasonFixture.season.groupId,
    tournamentId: seasonFixture.season.tournamentId,
    name: seasonFixture.season.name,
    lockAt: new Date(seasonFixture.season.lockAt),
    status: seasonFixture.season.status,
    scoringConfig: seasonFixture.season.scoringConfig,
    memberSnapshot: seasonFixture.season.memberSnapshot,
    createdAt: new Date(seasonFixture.season.createdAt),
    settledAt: seasonFixture.season.settledAt
      ? new Date(seasonFixture.season.settledAt)
      : null,
  });

  await db.insert(schema.question).values(
    seasonFixture.questions.map((question) => ({
      id: question.id,
      seasonId: seasonFixture.season.id,
      type: question.type,
      prompt: question.prompt,
      config: question.config,
      points: question.points,
      sortOrder: question.sortOrder,
      settlement: question.settlement,
      createdAt: new Date(question.createdAt),
    }))
  );

  await db.insert(schema.pick).values(
    seasonFixture.picks.map((pick) => ({
      id: pick.id,
      questionId: pick.questionId,
      memberId: pick.memberId,
      answer: pick.answer,
      submittedAt: new Date(pick.submittedAt),
      updatedAt: new Date(pick.updatedAt),
    }))
  );

  await db.insert(schema.pickHistory).values(
    seasonFixture.pickHistory.map((entry) => ({
      pickId: entry.pickId,
      answer: entry.answer,
      recordedAt: new Date(entry.recordedAt),
    }))
  );

  await db.insert(schema.comment).values(
    seasonFixture.comments.map((comment) => ({
      id: comment.id,
      seasonId: seasonFixture.season.id,
      questionId: comment.questionId,
      memberId: comment.memberId,
      body: comment.body,
      createdAt: new Date(comment.createdAt),
      deletedAt: comment.deletedAt ? new Date(comment.deletedAt) : null,
    }))
  );

  console.log("Seeding results, live state, standings snapshot...");
  await db.insert(schema.result).values({
    id: seasonFixture.result.id,
    tournamentId: seasonFixture.result.tournamentId,
    kind: seasonFixture.result.kind,
    payload: seasonFixture.result.payload,
    source: seasonFixture.result.source,
    isFinal: seasonFixture.result.isFinal,
    recordedAt: new Date(seasonFixture.result.recordedAt),
    recordedBy: seasonFixture.result.recordedBy,
  });

  await db.insert(schema.liveState).values({
    tournamentId: liveStateFixture.tournamentId,
    tableData: liveStateFixture.tableData,
    statLeaders: liveStateFixture.statLeaders,
    source: liveStateFixture.source,
    fetchedAt: new Date(liveStateFixture.fetchedAt),
  });

  await db.insert(schema.standingsSnapshot).values({
    seasonId: seasonFixture.standingsSnapshot.seasonId,
    isProjected: seasonFixture.standingsSnapshot.isProjected,
    standings: seasonFixture.standingsSnapshot.standings,
    computedAt: new Date(seasonFixture.standingsSnapshot.computedAt),
  });

  await pool.end();
  console.log("Seed complete.");
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
