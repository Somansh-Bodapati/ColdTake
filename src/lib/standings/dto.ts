// Row -> API-response mapping for api/seasons/[id]/standings/*, mirrors
// src/lib/seasons/dto.ts / src/lib/picks/dto.ts.

import type { StandingsSnapshotRow } from "@/lib/standings/service";
import type { StandingsSnapshotResponse } from "@/lib/schemas/standings";

export function toStandingsSnapshotResponse(row: StandingsSnapshotRow): StandingsSnapshotResponse {
  return {
    seasonId: row.seasonId,
    isProjected: row.isProjected,
    computedAt: row.computedAt.toISOString(),
    standings: row.standings,
  };
}
