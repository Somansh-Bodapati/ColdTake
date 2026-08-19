// Default question templates — doc 01 §2.3 step 2: "Selects which question
// templates to include — defaults pre-checked for that tournament type", and
// doc 01 §4.1's base-points table. Pure: given a tournament's shape, returns
// the standard question set an admin sees pre-populated when creating a
// season, each already flagged whether it starts checked. No I/O — the
// caller (the season-creation route, or the season-creation UI directly,
// since this has no DB access) supplies the tournament row.
//
// This intentionally covers only the templates that need nothing beyond the
// tournament's own catalogue data (team count / stat categories) to have a
// sensible default config. `team_over_under` needs an admin to pick a
// specific team and threshold, and `custom` is never a template by
// definition (doc 01 §3: "the fallback that makes the whole thing robust")
// — both are added via the custom/add-question builder instead.

import type { QuestionConfig, QuestionType, SettlementMode } from "@/lib/db/schema";

export interface QuestionTemplateInput {
  shortName: string;
  config: { statCategories?: string[] };
}

export interface QuestionTemplate {
  /** Stable key for the UI checklist — not persisted. */
  key: string;
  type: QuestionType;
  prompt: string;
  config: QuestionConfig;
  points: number;
  settlement: SettlementMode;
  /** Whether this template starts checked/included by default. */
  preChecked: boolean;
}

// doc 01 §4.1 default points, keyed by stat category (for the categories the
// doc names explicitly). Any other category the tournament declares still
// gets a template, just at the generic "custom" default (10 pts, doc 01
// §4.1's fallback for anything not named in the table).
const STAT_LEADER_LABELS: Record<string, { label: string; points: number }> = {
  runs: { label: "Leading run scorer", points: 15 },
  wickets: { label: "Leading wicket taker", points: 15 },
  sixes: { label: "Most sixes", points: 10 },
};
const GENERIC_STAT_POINTS = 10;

export function buildDefaultQuestionTemplates(tournament: QuestionTemplateInput): QuestionTemplate[] {
  const templates: QuestionTemplate[] = [
    {
      key: "champion",
      type: "champion",
      prompt: `Who wins ${tournament.shortName}?`,
      config: {},
      points: 25,
      settlement: "auto",
      preChecked: true,
    },
    {
      key: "runner_up",
      type: "runner_up",
      prompt: "Who finishes runner-up?",
      config: {},
      points: 15,
      settlement: "auto",
      preChecked: true,
    },
    {
      key: "top_4_unordered",
      type: "top_n_unordered",
      prompt: "Which 4 teams make the playoffs?",
      config: { n: 4 },
      points: 20, // 5 per correct team, doc 01 §4.1
      settlement: "auto",
      preChecked: true,
    },
    {
      key: "top_4_ordered",
      type: "top_n_ordered",
      prompt: "Predict the exact top 4, in order.",
      config: { n: 4, exactBonus: 10 },
      points: 20, // 5 per correct team + 10 exact-order bonus, doc 01 §4.1
      settlement: "auto",
      preChecked: false, // a harder variant of top_4_unordered — offered, not forced
    },
    {
      key: "wooden_spoon",
      type: "wooden_spoon",
      prompt: "Who finishes last?",
      config: {},
      points: 10,
      settlement: "auto",
      preChecked: true,
    },
  ];

  const statCategories = tournament.config.statCategories ?? [];
  for (const statCategory of statCategories) {
    const known = STAT_LEADER_LABELS[statCategory];
    templates.push({
      key: `stat_leader_${statCategory}`,
      type: "stat_leader",
      prompt: known ? `Who wins the ${known.label}?` : `Who leads in ${statCategory}?`,
      config: { statCategory },
      points: known?.points ?? GENERIC_STAT_POINTS,
      settlement: "auto",
      preChecked: true,
    });
  }

  templates.push(
    {
      key: "numeric_guess",
      type: "numeric",
      prompt: `Total sixes hit in ${tournament.shortName}? (closest guess wins)`,
      config: { secondPlaceRatio: 0.5 },
      points: 10, // 10 to closest, 5 to second closest, doc 01 §4.1
      settlement: "manual",
      preChecked: false,
    },
    {
      key: "yes_no",
      type: "boolean",
      prompt: "Will there be a Super Over this season?",
      config: {},
      points: 5,
      settlement: "manual",
      preChecked: false,
    }
  );

  return templates;
}
