// Drizzle schema for ColdTake. Mirrors docs/03-DATA-MODEL-AND-API.md §1
// table-for-table. Postgres, money-free (no currency types anywhere).
//
// jsonb columns are given a concrete shape via `.$type<...>()` per the
// comment in the doc describing their contents; the shapes are exported so
// callers (queries, seed scripts, the scoring engine's I/O boundary) share
// one definition instead of re-deriving it.

import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// 1.1 Identity
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email").unique(), // nullable: anonymous users have none
  avatarSeed: text("avatar_seed").notNull(), // deterministic generated avatar
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }), // set when they attach an email
});

export const userRelations = relations(user, ({ many }) => ({
  authTokens: many(authToken),
  members: many(member),
  createdGroups: many(group),
}));

// 'login' | 'claim' | 'session'. 'login' and 'claim' are single-use,
// short-expiry magic-link tokens (doc 03 §5 security checklist); 'session'
// is the long-lived cookie token for an ongoing signed-in session (Session
// 5 — no dedicated session table exists, so it reuses this table rather
// than adding one, per docs/DECISIONS.md).
export type AuthTokenPurpose = "login" | "claim" | "session";

// Magic-link and session tokens. Only ever stores a hash of the token —
// never the raw value (doc 03 §5: "Magic-link tokens stored hashed,
// single-use, short expiry").
export const authToken = pgTable(
  "auth_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // store a hash, never the raw token
    purpose: text("purpose").$type<AuthTokenPurpose>().notNull(),
    // Pending email for an in-flight 'claim' token — copied onto user.email
    // only once the token is verified. Unused for 'login'/'session'.
    email: text("email"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    // Verify/session lookups go straight from raw token -> hash -> row.
    unique("auth_token_token_hash_unique").on(table.tokenHash),
    index("auth_token_user_id_purpose_idx").on(table.userId, table.purpose),
  ]
);

export const authTokenRelations = relations(authToken, ({ one }) => ({
  user: one(user, { fields: [authToken.userId], references: [user.id] }),
}));

// ---------------------------------------------------------------------------
// 1.2 Groups
// ---------------------------------------------------------------------------

export const group = pgTable("group", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // for pretty URLs
  // 6 chars, uppercase, no ambiguous glyphs (no O/0/I/1)
  joinCode: text("join_code").notNull().unique(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const groupRelations = relations(group, ({ one, many }) => ({
  createdByUser: one(user, {
    fields: [group.createdBy],
    references: [user.id],
  }),
  members: many(member),
  seasons: many(season),
}));

// 'admin' | 'member'
export type MemberRole = "admin" | "member";

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<MemberRole>().notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [
    unique().on(table.groupId, table.userId),
    // Active-roster lookups ("who's in this group right now") are the hot
    // path for the member list and lock-state checks.
    index("member_group_id_active_idx")
      .on(table.groupId)
      .where(sql`${table.removedAt} is null`),
    index("member_user_id_idx").on(table.userId),
  ]
);

export const memberRelations = relations(member, ({ one, many }) => ({
  group: one(group, { fields: [member.groupId], references: [group.id] }),
  user: one(user, { fields: [member.userId], references: [user.id] }),
  picks: many(pick),
  comments: many(comment),
}));

// ---------------------------------------------------------------------------
// 1.3 Tournament catalogue (system-owned, not user-editable)
// ---------------------------------------------------------------------------

// 'cricket' | 'football' | ...
export type Sport = "cricket" | "football";
// 'upcoming' | 'live' | 'completed' | 'abandoned'
export type TournamentStatus = "upcoming" | "live" | "completed" | "abandoned";

// Which StandingsProvider (src/lib/providers/types.ts) ingestion should use
// for this tournament. Genuinely missing before Session 11 — ManualProvider
// was the only implementation, so there was nothing to choose between.
// Defaults to "manual" wherever unset (api/ingest/[tournamentId].ts), so
// every tournament created before this field existed keeps behaving exactly
// as it did.
export type TournamentProviderKey = "manual" | "cricketdata";

// Sport-specific: stat categories available, playoff format.
export interface TournamentConfig {
  statCategories?: string[];
  playoffFormat?: string;
  provider?: TournamentProviderKey;
  [key: string]: unknown;
}

export const tournament = pgTable("tournament", {
  id: text("id").primaryKey(), // e.g. 'ipl-2027'
  sport: text("sport").$type<Sport>().notNull(),
  name: text("name").notNull(), // 'Indian Premier League 2027'
  shortName: text("short_name").notNull(), // 'IPL 2027'
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  status: text("status").$type<TournamentStatus>().notNull(),
  teamCount: integer("team_count").notNull(),
  providerKey: text("provider_key"), // external ID for the data provider
  config: jsonb("config").$type<TournamentConfig>().notNull(),
});

export const tournamentRelations = relations(tournament, ({ many }) => ({
  teams: many(team),
  players: many(player),
  seasons: many(season),
  results: many(result),
}));

export const team = pgTable("team", {
  id: text("id").primaryKey(),
  tournamentId: text("tournament_id")
    .notNull()
    .references(() => tournament.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(), // 'CSK'
  color: text("color"), // brand hex, for the UI
  providerKey: text("provider_key"),
});

export const teamRelations = relations(team, ({ one, many }) => ({
  tournament: one(tournament, {
    fields: [team.tournamentId],
    references: [tournament.id],
  }),
  players: many(player),
}));

// 'batter' | 'bowler' | 'allrounder' | 'keeper'
export type PlayerRole = "batter" | "bowler" | "allrounder" | "keeper";

export const player = pgTable("player", {
  id: text("id").primaryKey(),
  tournamentId: text("tournament_id")
    .notNull()
    .references(() => tournament.id, { onDelete: "cascade" }),
  // Squad churn caveat (doc 03 §1.3): players move between teams and squads
  // are announced late. This is a point-in-time convenience, not a fact to
  // score against — never make scoring depend on it.
  teamId: text("team_id").references(() => team.id),
  name: text("name").notNull(),
  role: text("role").$type<PlayerRole>(),
  providerKey: text("provider_key"),
});

export const playerRelations = relations(player, ({ one }) => ({
  tournament: one(tournament, {
    fields: [player.tournamentId],
    references: [tournament.id],
  }),
  team: one(team, { fields: [player.teamId], references: [team.id] }),
}));

// ---------------------------------------------------------------------------
// 1.4 Seasons and slates
// ---------------------------------------------------------------------------

// 'draft' | 'open' | 'locked' | 'settled' | 'voided'
export type SeasonStatus = "draft" | "open" | "locked" | "settled" | "voided";
// 'zero' | 'void'
export type InjuryRule = "zero" | "void";

export interface SeasonScoringConfig {
  boldPickEnabled: boolean;
  injuryRule: InjuryRule;
}

// One group playing one tournament.
export const season = pgTable(
  "season",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "cascade" }),
    tournamentId: text("tournament_id")
      .notNull()
      .references(() => tournament.id),
    name: text("name").notNull(), // usually the tournament short_name
    lockAt: timestamp("lock_at", { withTimezone: true }).notNull(),
    status: text("status").$type<SeasonStatus>().notNull(),
    scoringConfig: jsonb("scoring_config")
      .$type<SeasonScoringConfig>()
      .notNull(),
    // Array of member_ids, frozen at lock. Drives boldness.
    memberSnapshot: jsonb("member_snapshot").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    // Session 12: the `voided` transition (doc 01 §4.3: "Team withdraws or
    // tournament is abandoned — Admin can void the entire season; no scores
    // recorded"). `voidReason` is required by the service layer, not the
    // schema, so it doubles as this action's audit trail (who/when comes
    // from the admin session that made the call and this timestamp).
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    voidedBy: text("voided_by"), // user_id of the admin who voided it
  },
  (table) => [
    unique().on(table.groupId, table.tournamentId),
    index("season_group_id_status_idx").on(table.groupId, table.status),
  ]
);

export const seasonRelations = relations(season, ({ one, many }) => ({
  group: one(group, { fields: [season.groupId], references: [group.id] }),
  tournament: one(tournament, {
    fields: [season.tournamentId],
    references: [tournament.id],
  }),
  questions: many(question),
  comments: many(comment),
  standingsSnapshots: many(standingsSnapshot),
}));

// 'champion' | 'runner_up' | 'top_n_unordered' | 'top_n_ordered' |
// 'wooden_spoon' | 'stat_leader' | 'team_over_under' | 'numeric' |
// 'boolean' | 'custom'
export type QuestionType =
  | "champion"
  | "runner_up"
  | "top_n_unordered"
  | "top_n_ordered"
  | "wooden_spoon"
  | "stat_leader"
  | "team_over_under"
  | "numeric"
  | "boolean"
  | "custom";

// Type-specific: { n: 4 } | { statCategory: 'runs' } | { options: [...] } for custom.
export interface QuestionConfig {
  n?: number;
  statCategory?: string;
  options?: { id: string; label: string }[];
  [key: string]: unknown;
}

// 'auto' | 'manual'
export type SettlementMode = "auto" | "manual";

export const question = pgTable(
  "question",
  {
    id: text("id").primaryKey(),
    seasonId: text("season_id")
      .notNull()
      .references(() => season.id, { onDelete: "cascade" }),
    type: text("type").$type<QuestionType>().notNull(),
    prompt: text("prompt").notNull(), // display text, e.g. 'Who wins the Orange Cap?'
    config: jsonb("config").$type<QuestionConfig>().notNull(),
    points: integer("points").notNull(),
    sortOrder: integer("sort_order").notNull(),
    settlement: text("settlement").$type<SettlementMode>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("question_season_id_sort_order_idx").on(
      table.seasonId,
      table.sortOrder
    ),
  ]
);

export const questionRelations = relations(question, ({ one, many }) => ({
  season: one(season, {
    fields: [question.seasonId],
    references: [season.id],
  }),
  picks: many(pick),
  comments: many(comment),
}));

// { teamId } | { teamIds: [...] } | { playerId } | { value: 42 } |
// { bool: true } | { optionId }
export interface PickAnswer {
  teamId?: string;
  teamIds?: string[];
  playerId?: string;
  value?: number;
  bool?: boolean;
  optionId?: string;
}

export const pick = pgTable(
  "pick",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    answer: jsonb("answer").$type<PickAnswer>().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.questionId, table.memberId),
    index("pick_question_id_idx").on(table.questionId),
  ]
);

export const pickRelations = relations(pick, ({ one, many }) => ({
  question: one(question, {
    fields: [pick.questionId],
    references: [question.id],
  }),
  member: one(member, { fields: [pick.memberId], references: [member.id] }),
  history: many(pickHistory),
}));

// Append-only audit of every pick change. Never deleted.
export const pickHistory = pgTable("pick_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  // Not a FK: pick rows can be superseded/deleted in principle, but this
  // audit trail must survive regardless (doc 03 §1.4: "never deleted").
  pickId: text("pick_id").notNull(),
  answer: jsonb("answer").$type<PickAnswer>().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// 1.5 Results and standings
// ---------------------------------------------------------------------------

// 'final_table' | 'stat_leaders' | 'final_result'
export type ResultKind = "final_table" | "stat_leaders" | "final_result";
// 'manual' | 'cricketdata' | 'admin_override'
export type ResultSource = "manual" | "cricketdata" | "admin_override";

// Immutable facts about what actually happened. Never updated in place.
export const result = pgTable("result", {
  id: text("id").primaryKey(),
  tournamentId: text("tournament_id")
    .notNull()
    .references(() => tournament.id, { onDelete: "cascade" }),
  kind: text("kind").$type<ResultKind>().notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  source: text("source").$type<ResultSource>().notNull(),
  isFinal: boolean("is_final").notNull().default(false),
  recordedAt: timestamp("recorded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  recordedBy: text("recorded_by"), // user_id if manual
});

export const resultRelations = relations(result, ({ one }) => ({
  tournament: one(tournament, {
    fields: [result.tournamentId],
    references: [tournament.id],
  }),
}));

// Session 12: settled facts for question types that aren't derivable from
// `result`'s finalTable/finalResult/statLeaders — `boolean`, `custom`, and
// `numeric` (src/lib/scoring/types.ts's ResultSet.questionResults doc
// comment). Also the doc 01 §4.3 "data source disagrees with reality" escape
// hatch for *every* type: an admin override on an already-settled question
// is just another row here with source='override' and a required `note`.
// Append-only like `result` and `pick_history` — "store this, don't just
// silently overwrite" (this session's brief, task 3) — so the current
// settled value for a question is simply its latest row by `settledAt`.
export type QuestionResultSource = "manual" | "override";

export const questionResult = pgTable(
  "question_result",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => question.id, { onDelete: "cascade" }),
    answer: jsonb("answer").$type<PickAnswer>().notNull(),
    source: text("source").$type<QuestionResultSource>().notNull(),
    // Required (enforced in src/lib/seasons/settlement.ts) when source is
    // 'override' — the audit note doc 01 §4.3 calls for. Optional, usually
    // omitted, for the first ('manual') settlement of a question.
    note: text("note"),
    settledBy: text("settled_by").notNull(), // user_id of the admin who settled/overrode it
    settledAt: timestamp("settled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("question_result_question_id_settled_at_idx").on(
      table.questionId,
      table.settledAt.desc()
    ),
  ]
);

export const questionResultRelations = relations(questionResult, ({ one }) => ({
  question: one(question, {
    fields: [questionResult.questionId],
    references: [question.id],
  }),
}));

export interface LiveStateTableRow {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  points: number;
  nrr: number;
  position: number;
}

export interface LiveStateStatLeaderEntry {
  playerId: string;
  value: number;
}

export interface LiveStateStatLeaders {
  runs?: LiveStateStatLeaderEntry[];
  wickets?: LiveStateStatLeaderEntry[];
  sixes?: LiveStateStatLeaderEntry[];
  [statCategory: string]: LiveStateStatLeaderEntry[] | undefined;
}

// Current in-season state, overwritten on each ingestion. One row per tournament.
export const liveState = pgTable("live_state", {
  tournamentId: text("tournament_id")
    .primaryKey()
    .references(() => tournament.id, { onDelete: "cascade" }),
  tableData: jsonb("table_data").$type<LiveStateTableRow[]>().notNull(),
  statLeaders: jsonb("stat_leaders").$type<LiveStateStatLeaders>().notNull(),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export const liveStateRelations = relations(liveState, ({ one }) => ({
  tournament: one(tournament, {
    fields: [liveState.tournamentId],
    references: [tournament.id],
  }),
}));

// Same status vocabulary as src/lib/scoring/types.ts's `PickStatus` —
// duplicated rather than imported, to keep the dependency direction the
// scoring engine already establishes (src/lib/scoring/types.ts imports
// PickAnswer/QuestionConfig/QuestionType *from* this file, never the
// reverse — CLAUDE.md rule 1's scoring-engine purity extends to "the engine
// owns its own types," so this file doesn't reach back into it).
export type StandingsPickStatus =
  | "correct"
  | "partial"
  | "incorrect"
  | "pending"
  | "no_pick";

// The doc's own shape is just { questionId, points }; the extra fields
// (maxPossible/status/boldnessMultiplier/explanation) are this session's
// addition (Session 9 brief, task 4) so a member's breakdown view can be
// rendered directly from the snapshot — the same shape
// src/lib/scoring/types.ts's `QuestionBreakdown` already produces — without
// the read path ever recomputing `score()`.
export interface StandingsBreakdownEntry {
  questionId: string;
  points: number;
  maxPossible: number;
  status: StandingsPickStatus;
  boldnessMultiplier: number;
  explanation: string;
}

export interface StandingsEntry {
  memberId: string;
  // Denormalized at write time (Session 9 brief, task 5): the leaderboard
  // read path must stay a single query against this table alone, never a
  // join out to member/user for display names.
  displayName: string;
  rank: number;
  points: number;
  delta: number;
  breakdown: StandingsBreakdownEntry[];
}

// The materialised leaderboard. THIS is what the app reads. Recomputed
// after ingestion. See the doc's own note: this is the single most
// important performance/cost decision in the schema, so every leaderboard
// read is one indexed row fetch of a JSON blob instead of a live join.
export const standingsSnapshot = pgTable(
  "standings_snapshot",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    seasonId: text("season_id")
      .notNull()
      .references(() => season.id, { onDelete: "cascade" }),
    isProjected: boolean("is_projected").notNull(), // true during season, false once settled
    standings: jsonb("standings").$type<StandingsEntry[]>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("standings_snapshot_season_id_computed_at_idx").on(
      table.seasonId,
      table.computedAt.desc()
    ),
  ]
);

export const standingsSnapshotRelations = relations(
  standingsSnapshot,
  ({ one }) => ({
    season: one(season, {
      fields: [standingsSnapshot.seasonId],
      references: [season.id],
    }),
  })
);

// Same shape as scoring/types.ts's FinalResult, duplicated rather than
// imported — this file never reaches into src/lib/scoring (see
// StandingsPickStatus's comment above for why the dependency direction only
// ever runs scoring -> schema, never the reverse).
export interface ManualFinalResult {
  championTeamId?: string;
  runnerUpTeamId?: string;
}

// Session 10's admin-edited backing store for ManualProvider
// (src/lib/providers/manual-provider.ts) — doc 02 §4.3: "ManualProvider
// (reads from an admin-edited table)." One row per tournament, overwritten
// on every admin save (POST /api/admin/manual-standings/:tournamentId, doc
// 03 §3.6) — this is the *input* an admin types in; `live_state` below is
// the *output* of running it (or any other provider) through ingestion.
export const manualStandingsInput = pgTable("manual_standings_input", {
  tournamentId: text("tournament_id")
    .primaryKey()
    .references(() => tournament.id, { onDelete: "cascade" }),
  tableData: jsonb("table_data").$type<LiveStateTableRow[]>().notNull(),
  statLeaders: jsonb("stat_leaders").$type<LiveStateStatLeaders>().notNull(),
  finalResult: jsonb("final_result").$type<ManualFinalResult>(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: text("updated_by"), // user_id of the admin who last saved it
});

export const manualStandingsInputRelations = relations(manualStandingsInput, ({ one }) => ({
  tournament: one(tournament, {
    fields: [manualStandingsInput.tournamentId],
    references: [tournament.id],
  }),
}));

// ---------------------------------------------------------------------------
// 1.6 Social
// ---------------------------------------------------------------------------

export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(),
    seasonId: text("season_id")
      .notNull()
      .references(() => season.id, { onDelete: "cascade" }),
    // null = general thread
    questionId: text("question_id").references(() => question.id, {
      onDelete: "cascade",
    }),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("comment_season_id_created_at_idx").on(
      table.seasonId,
      table.createdAt.desc()
    ),
  ]
);

export const commentRelations = relations(comment, ({ one }) => ({
  season: one(season, {
    fields: [comment.seasonId],
    references: [season.id],
  }),
  question: one(question, {
    fields: [comment.questionId],
    references: [question.id],
  }),
  member: one(member, { fields: [comment.memberId], references: [member.id] }),
}));
