// Row -> API-response mapping for api/seasons/[id]/picks/*, mirrors
// src/lib/seasons/dto.ts.

import type { pick } from "@/lib/db/schema";
import type { MemberPicksRow } from "@/lib/picks/service";
import type { MemberPicks, PickResponse } from "@/lib/schemas/picks";

type PickRow = typeof pick.$inferSelect;

export function toPickResponse(row: PickRow): PickResponse {
  return {
    id: row.id,
    questionId: row.questionId,
    answer: row.answer,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMemberPicksResponse(row: MemberPicksRow): MemberPicks {
  return {
    memberId: row.memberId,
    userId: row.userId,
    displayName: row.displayName,
    picks: row.picks.map(toPickResponse),
  };
}
