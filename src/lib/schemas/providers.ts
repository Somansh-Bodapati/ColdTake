// Zod schemas for the ingestion/manual-standings API boundary (doc 03
// §3.6-3.7), shared by client and server — mirrors src/lib/schemas/standings.ts.
// Structurally matches src/lib/db/schema.ts's LiveStateTableRow /
// LiveStateStatLeaderEntry exactly, since this is the admin-facing input to
// (and the response shape of) src/lib/providers/ingest.ts.

import { z } from "zod";

export const teamStandingSchema = z
  .object({
    teamId: z.string().trim().min(1),
    played: z.number().int().nonnegative(),
    won: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
    nrr: z.number(),
    position: z.number().int().positive(),
  })
  .strict();
export type TeamStandingInput = z.infer<typeof teamStandingSchema>;

export const playerStatSchema = z
  .object({
    playerId: z.string().trim().min(1),
    value: z.number(),
  })
  .strict();
export type PlayerStatInput = z.infer<typeof playerStatSchema>;

export const manualFinalResultSchema = z
  .object({
    championTeamId: z.string().trim().min(1).optional(),
    runnerUpTeamId: z.string().trim().min(1).optional(),
  })
  .strict();
export type ManualFinalResultInput = z.infer<typeof manualFinalResultSchema>;

// POST /api/admin/manual-standings/:tournamentId — doc 03 §3.6 [group admin
// or system admin]: "manual table + stat leader entry."
export const manualStandingsRequestSchema = z.object({
  tableData: z.array(teamStandingSchema).min(1, "At least one team row is required"),
  statLeaders: z.record(z.string(), z.array(playerStatSchema)).default({}),
  finalResult: manualFinalResultSchema.optional(),
});
export type ManualStandingsRequest = z.infer<typeof manualStandingsRequestSchema>;

// Shared response for both ingestion triggers (POST /api/ingest/:tournamentId
// and the manual-standings endpoint above) — doc 03 §3.7: writes live_state,
// then recomputes standings_snapshot for every active season on that
// tournament. `recomputedSeasonIds` lets a caller see the fan-out actually
// happened, without echoing back every full snapshot.
export const ingestResponseSchema = z.object({
  tournamentId: z.string(),
  source: z.string(),
  fetchedAt: z.string(),
  tableData: z.array(teamStandingSchema),
  statLeaders: z.record(z.string(), z.array(playerStatSchema)),
  recomputedSeasonIds: z.array(z.string()),
});
export type IngestResponse = z.infer<typeof ingestResponseSchema>;
