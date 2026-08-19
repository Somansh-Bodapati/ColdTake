// Row -> API-response mapping shared by every api/seasons/* and
// api/tournaments/* route, so the ISO-string/JSON-safe shape is defined once
// instead of re-derived per handler.

import type { question, season } from "@/lib/db/schema";
import type { QuestionResponse, SeasonResponse } from "@/lib/schemas/seasons";

type SeasonRow = typeof season.$inferSelect;
type QuestionRow = typeof question.$inferSelect;

export function toSeasonResponse(row: SeasonRow): SeasonResponse {
  return {
    id: row.id,
    groupId: row.groupId,
    tournamentId: row.tournamentId,
    name: row.name,
    lockAt: row.lockAt.toISOString(),
    status: row.status,
    scoringConfig: row.scoringConfig,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    voidReason: row.voidReason,
  };
}

export function toQuestionResponse(row: QuestionRow): QuestionResponse {
  return {
    id: row.id,
    seasonId: row.seasonId,
    type: row.type,
    prompt: row.prompt,
    config: row.config,
    points: row.points,
    sortOrder: row.sortOrder,
    settlement: row.settlement,
    createdAt: row.createdAt.toISOString(),
  };
}
