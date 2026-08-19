// Season state machine — doc 03 §4:
//
//   draft --publish--> open --lock_at reached--> locked --settle--> settled
//     \_______________/________________________/_____________> voided
//                          (admin, any state, with a reason)
//
// The open -> locked edge is the one CLAUDE.md rule 3 and doc 03 §4 are
// explicit about: "Enforce lazily — check now() > lock_at on every read and
// write rather than relying on a scheduled job. This avoids depending on a
// cron for correctness." So this whole module is pure functions of
// (storedStatus, lockAt, now) — `now` is always an explicit parameter, never
// read internally via Date.now(), which is what keeps it unit-testable and
// keeps every caller (src/lib/seasons/service.ts) responsible for supplying
// the current time itself rather than trusting a background job to have
// already flipped the row.
//
// This module isn't inside src/lib/scoring/ (CLAUDE.md rule 1 is specific to
// the scoring engine) and doesn't need to be as strictly I/O-free as that
// folder, but the derivation logic itself has no I/O and no hidden clock —
// only the callers in service.ts do DB reads/writes around it.

import type { SeasonStatus } from "@/lib/db/schema";

const TERMINAL_STATUSES: ReadonlySet<SeasonStatus> = new Set(["settled", "voided"]);

/**
 * The season's *effective* status given the current time — what every route
 * should treat as true, regardless of what's still persisted in the `status`
 * column. Only the open -> locked edge is time-driven; every other
 * transition (draft -> open, locked -> settled, any -> voided) is an
 * explicit admin action recorded directly in `status`, so this function
 * leaves those alone.
 */
export function effectiveSeasonStatus(
  storedStatus: SeasonStatus,
  lockAt: Date,
  now: Date
): SeasonStatus {
  if (storedStatus === "open" && now.getTime() >= lockAt.getTime()) {
    return "locked";
  }
  return storedStatus;
}

/** True once a season has reached a status nothing can leave. */
export function isTerminalStatus(status: SeasonStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// Questions/lockAt/scoringConfig may only change before the slate is live to
// picks — doc 03 §3.3: "[admin, only while draft/open]" on PATCH /seasons/:id
// and the questions endpoints.
export function isMutableStatus(status: SeasonStatus): boolean {
  return status === "draft" || status === "open";
}

export interface PublishCheck {
  questionCount: number;
  lockAt: Date;
  now: Date;
}

// draft -> open: requires >= 1 question and a lock_at in the future (doc 03
// §4's transition rule, verbatim).
export function canPublish({ questionCount, lockAt, now }: PublishCheck): boolean {
  return questionCount >= 1 && lockAt.getTime() > now.getTime();
}

// void/settle (locked -> settled, any -> voided) belong to the settlement
// session (doc 03 §3.6) — out of scope here; this module only covers the
// draft/open/locked edges this session's routes actually exercise.
