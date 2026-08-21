// Zod schemas for the seasons/tournaments API boundary (doc 03 §3.3),
// shared by client and server — mirrors src/lib/schemas/groups.ts.
//
// Each question type gets its own `config` schema instead of one loose
// `z.record`, so a bad admin-submitted config (missing `n`, an empty
// `options` list, etc.) is rejected at the API boundary with a useful
// message rather than silently reaching the scoring engine later. The shape
// of each config schema is deliberately the same shape each resolver in
// src/lib/scoring/resolvers/*.ts already reads off `question.config` — see
// that folder for the authoritative field names — so a question created here
// is structurally exactly what the Session 2-4 engine expects, custom
// included (src/lib/scoring/resolvers/custom.ts requires a non-empty
// `config.options: {id, label}[]`, which customQuestionConfigSchema mirrors).

import { z } from "zod";

export const questionTypeSchema = z.enum([
  "champion",
  "runner_up",
  "top_n_unordered",
  "top_n_ordered",
  "wooden_spoon",
  "stat_leader",
  "team_over_under",
  "numeric",
  "boolean",
  "custom",
]);

export const settlementModeSchema = z.enum(["auto", "manual"]);

const promptSchema = z.string().trim().min(1, "Prompt is required").max(300, "Prompt is too long");
const pointsSchema = z.number().int().positive("Points must be a positive integer");

const emptyConfigSchema = z.object({}).strict();
const topNConfigSchema = z.object({ n: z.number().int().positive() }).strict();
const topNOrderedConfigSchema = z
  .object({ n: z.number().int().positive(), exactBonus: z.number().int().nonnegative().optional() })
  .strict();
const statLeaderConfigSchema = z.object({ statCategory: z.string().trim().min(1) }).strict();
const teamOverUnderConfigSchema = z
  .object({
    teamId: z.string().trim().min(1),
    threshold: z.number(),
    comparison: z.enum(["over", "under"]),
  })
  .strict();
const numericConfigSchema = z.object({ secondPlaceRatio: z.number().min(0).max(1).optional() }).strict();
// The custom question builder (this session's brief, task 4): an
// admin-defined multiple-choice question. `options` must have at least 2
// entries — a single-option "choice" isn't a question — and matches
// src/lib/scoring/resolvers/custom.ts's `configOptionIds` exactly.
const customConfigSchema = z
  .object({
    options: z
      .array(z.object({ id: z.string().trim().min(1), label: z.string().trim().min(1) }))
      .min(2, "A custom question needs at least 2 options"),
  })
  .strict();

// One discriminated-union member per question type — `type` selects which
// `config` shape is required, and each variant defaults `settlement` to what
// doc 01 §3's "Settlement source" column implies for that type (an admin can
// still override it explicitly).
export const questionInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("champion"),
    prompt: promptSchema,
    config: emptyConfigSchema.default({}),
    points: pointsSchema,
    settlement: settlementModeSchema.default("auto"),
  }),
  z.object({
    type: z.literal("runner_up"),
    prompt: promptSchema,
    config: emptyConfigSchema.default({}),
    points: pointsSchema,
    settlement: settlementModeSchema.default("auto"),
  }),
  z.object({
    type: z.literal("top_n_unordered"),
    prompt: promptSchema,
    config: topNConfigSchema,
    points: pointsSchema,
    settlement: settlementModeSchema.default("auto"),
  }),
  z.object({
    type: z.literal("top_n_ordered"),
    prompt: promptSchema,
    config: topNOrderedConfigSchema,
    points: pointsSchema,
    settlement: settlementModeSchema.default("auto"),
  }),
  z.object({
    type: z.literal("wooden_spoon"),
    prompt: promptSchema,
    config: emptyConfigSchema.default({}),
    points: pointsSchema,
    settlement: settlementModeSchema.default("auto"),
  }),
  z.object({
    type: z.literal("stat_leader"),
    prompt: promptSchema,
    config: statLeaderConfigSchema,
    points: pointsSchema,
    settlement: settlementModeSchema.default("auto"),
  }),
  z.object({
    type: z.literal("team_over_under"),
    prompt: promptSchema,
    config: teamOverUnderConfigSchema,
    points: pointsSchema,
    settlement: settlementModeSchema.default("auto"),
  }),
  z.object({
    type: z.literal("numeric"),
    prompt: promptSchema,
    config: numericConfigSchema.default({}),
    points: pointsSchema,
    settlement: settlementModeSchema.default("manual"),
  }),
  z.object({
    type: z.literal("boolean"),
    prompt: promptSchema,
    config: emptyConfigSchema.default({}),
    points: pointsSchema,
    settlement: settlementModeSchema.default("manual"),
  }),
  z.object({
    type: z.literal("custom"),
    prompt: promptSchema,
    config: customConfigSchema,
    points: pointsSchema,
    settlement: settlementModeSchema.default("manual"),
  }),
]);
export type QuestionInput = z.infer<typeof questionInputSchema>;

export const questionResponseSchema = z.object({
  id: z.string(),
  seasonId: z.string(),
  type: questionTypeSchema,
  prompt: z.string(),
  config: z.record(z.string(), z.unknown()),
  points: z.number(),
  sortOrder: z.number(),
  settlement: settlementModeSchema,
  createdAt: z.string(),
});
export type QuestionResponse = z.infer<typeof questionResponseSchema>;

export const seasonScoringConfigSchema = z.object({
  boldPickEnabled: z.boolean(),
  injuryRule: z.enum(["zero", "void"]),
});
export type SeasonScoringConfigInput = z.infer<typeof seasonScoringConfigSchema>;

export const seasonStatusSchema = z.enum(["draft", "open", "locked", "settled", "voided"]);

export const seasonResponseSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  tournamentId: z.string(),
  name: z.string(),
  lockAt: z.string(),
  status: seasonStatusSchema,
  scoringConfig: seasonScoringConfigSchema,
  createdAt: z.string(),
  settledAt: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
});
export type SeasonResponse = z.infer<typeof seasonResponseSchema>;

// POST /api/seasons — doc 03 §3.3: { groupId, tournamentId, lockAt,
// questions[] } [admin]. `lockAt` is optional: doc 01 §2.3 step 4 says it
// "defaults to the scheduled start of match 1" — the closest fact the
// tournament catalogue has to that is `tournament.startsAt`, so the service
// falls back to it when omitted.
export const createSeasonRequestSchema = z.object({
  groupId: z.string().min(1, "groupId is required"),
  tournamentId: z.string().min(1, "tournamentId is required"),
  lockAt: z.string().datetime().optional(),
  scoringConfig: seasonScoringConfigSchema.optional(),
  questions: z.array(questionInputSchema).max(50, "Too many questions").default([]),
});
export type CreateSeasonRequest = z.infer<typeof createSeasonRequestSchema>;

// A season's tournament's real teams (this session's bug fix: the pick
// sheet needs a catalogue of valid teamIds to build a dropdown from, rather
// than free-typing a string like "RCB" that src/lib/scoring/resolvers/*.ts's
// `validate()` — via src/lib/picks/service.ts's Tournament.teamIds check —
// will reject unless it's a real internal team.id). Piggybacked onto season
// detail rather than a new /api/tournaments/:id/teams endpoint since the
// pick sheet already fetches this response and a season's tournament never
// changes after creation.
export const teamSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
});
export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const seasonDetailResponseSchema = z.object({
  season: seasonResponseSchema,
  questions: z.array(questionResponseSchema),
  teams: z.array(teamSummarySchema),
});
export type SeasonDetailResponse = z.infer<typeof seasonDetailResponseSchema>;

// PATCH /api/seasons/:id — doc 03 §3.3: { lockAt, scoringConfig } [admin,
// only while draft/open]. Both optional/independently updatable.
export const updateSeasonRequestSchema = z
  .object({
    lockAt: z.string().datetime().optional(),
    scoringConfig: seasonScoringConfigSchema.optional(),
  })
  .refine((body) => body.lockAt !== undefined || body.scoringConfig !== undefined, {
    message: "Provide at least one of lockAt or scoringConfig",
  });
export type UpdateSeasonRequest = z.infer<typeof updateSeasonRequestSchema>;

export const tournamentSummarySchema = z.object({
  id: z.string(),
  sport: z.enum(["cricket", "football"]),
  name: z.string(),
  shortName: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  status: z.enum(["upcoming", "live", "completed", "abandoned"]),
  teamCount: z.number(),
  config: z.object({ statCategories: z.array(z.string()).optional() }).catchall(z.unknown()),
});
export type TournamentSummary = z.infer<typeof tournamentSummarySchema>;

export const tournamentCatalogueResponseSchema = z.object({
  tournaments: z.array(tournamentSummarySchema),
});
export type TournamentCatalogueResponse = z.infer<typeof tournamentCatalogueResponseSchema>;
