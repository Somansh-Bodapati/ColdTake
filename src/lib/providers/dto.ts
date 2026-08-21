// Row -> API-response mapping for api/ingest/[tournamentId].ts and
// api/admin/manual-standings/[tournamentId].ts, mirrors
// src/lib/standings/dto.ts.

import type { LiveStateStatLeaderEntry } from "../db/schema.js";
import type { IngestResult } from "./ingest.js";
import type { IngestResponse } from "../schemas/providers.js";

export function toIngestResponse(result: IngestResult): IngestResponse {
  const statLeaders: Record<string, LiveStateStatLeaderEntry[]> = {};
  for (const [category, entries] of Object.entries(result.liveState.statLeaders)) {
    if (entries) {
      statLeaders[category] = entries;
    }
  }

  return {
    tournamentId: result.liveState.tournamentId,
    source: result.liveState.source,
    fetchedAt: result.liveState.fetchedAt.toISOString(),
    tableData: result.liveState.tableData,
    statLeaders,
    recomputedSeasonIds: result.recomputedSnapshots.map((snapshot) => snapshot.seasonId),
  };
}
