// Boldness multiplier — doc 03 §2.4.
// Pure: no I/O, no Date.now(), no DB access (CLAUDE.md rule 1).
//
// "compute boldness per team within the answer" (top_n_*) and "boldness on a
// single champion pick" turn out to be the same computation: split
// baseAwarded evenly across whichever units actually scored, multiply each
// unit by its own share-derived multiplier, sum, and floor once at the end.
// For a single-unit answer (champion) this collapses to the doc's plain
// `awarded = floor(baseAwarded × multiplier)` formula.

export function boldnessMultiplier(share: number, weight: number): number {
  const boldness = 1 - share;
  return 1 + boldness * weight;
}

/**
 * Fraction of the population whose picked units include `unit`.
 * `unitsByMember` should only contain members who actually picked (doc 03
 * §2.4: "Members with no pick for a question are excluded from the
 * denominator").
 */
export function computeShare(
  unit: string,
  unitsByMember: ReadonlyMap<string, readonly string[]>
): number {
  const population = unitsByMember.size;
  if (population === 0) {
    return 0;
  }
  let count = 0;
  for (const units of unitsByMember.values()) {
    if (units.includes(unit)) {
      count += 1;
    }
  }
  return count / population;
}

/**
 * Applies the boldness multiplier to a resolver's base awarded points.
 *
 * `correctUnits` are the units (e.g. team IDs) within this member's answer
 * that actually contributed to `baseAwarded` — for champion that's at most
 * one team, for top_n_unordered it's every correctly-picked team.
 * `shareForUnit` looks up each unit's population share (see `computeShare`).
 *
 * doc 03 §2.4: "Only applies to correct or partially correct picks. Wrong
 * picks score zero regardless" — callers should only call this when the
 * resolver's status was 'correct' or 'partial'; a `baseAwarded` of 0 is a
 * no-op here regardless, as a defensive fallback.
 */
export function applyBoldness(
  baseAwarded: number,
  correctUnits: readonly string[],
  shareForUnit: (unit: string) => number,
  weight: number
): { awarded: number; multiplier: number } {
  if (correctUnits.length === 0 || baseAwarded === 0) {
    return { awarded: baseAwarded, multiplier: 1 };
  }

  const perUnitValue = baseAwarded / correctUnits.length;
  let sum = 0;
  for (const unit of correctUnits) {
    sum += perUnitValue * boldnessMultiplier(shareForUnit(unit), weight);
  }

  return { awarded: Math.floor(sum), multiplier: sum / baseAwarded };
}
