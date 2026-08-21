// Shared narrowing helpers over `QuestionResponse.config`, which is typed as
// `z.record(z.string(), z.unknown())` at the API boundary
// (src/lib/schemas/seasons.ts) since its real shape depends on the
// question's `type`. Extracted out of src/routes/season-picks.tsx (which
// originally had its own private copy of `customOptions`) so the pick sheet
// and the reveal page — both of which need a custom question's option
// labels — read the exact same narrowing logic instead of two copies that
// could drift.

export interface CustomQuestionOption {
  id: string;
  label: string;
}

// `question.config.options` for a `custom` question — see
// src/lib/scoring/resolvers/custom.ts's `configOptionIds`, which this
// mirrors — is a `{ id, label }[]`. Anything else (missing, malformed) is
// treated as "no options" rather than thrown, matching the defensive style
// of every other config reader in this codebase.
export function customQuestionOptions(value: unknown): CustomQuestionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is CustomQuestionOption =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === "string" &&
      typeof (entry as { label?: unknown }).label === "string"
  );
}
