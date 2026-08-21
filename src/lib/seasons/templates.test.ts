// Pure unit tests for the default question template set — doc 01 §2.3/§4.1.

import { describe, expect, it } from "vitest";
import { buildDefaultQuestionTemplates } from "./templates";

const TOURNAMENT = { shortName: "CPL 2026", config: { statCategories: ["runs", "wickets", "sixes"] } };

describe("buildDefaultQuestionTemplates", () => {
  it("pre-checks the anchor questions: champion, runner-up, top-4, wooden spoon, stat leaders", () => {
    const templates = buildDefaultQuestionTemplates(TOURNAMENT);
    const preChecked = templates.filter((t) => t.preChecked).map((t) => t.key);
    expect(preChecked).toEqual(
      expect.arrayContaining([
        "champion",
        "runner_up",
        "top_4_unordered",
        "wooden_spoon",
        "stat_leader_runs",
        "stat_leader_wickets",
        "stat_leader_sixes",
      ])
    );
  });

  it("leaves the harder/manual templates unchecked by default", () => {
    const templates = buildDefaultQuestionTemplates(TOURNAMENT);
    const uncheckedKeys = templates.filter((t) => !t.preChecked).map((t) => t.key);
    expect(uncheckedKeys).toEqual(expect.arrayContaining(["top_4_ordered", "numeric_guess", "yes_no"]));
  });

  it("applies doc 01 §4.1's default point values", () => {
    const byKey = Object.fromEntries(buildDefaultQuestionTemplates(TOURNAMENT).map((t) => [t.key, t]));
    expect(byKey.champion.points).toBe(25);
    expect(byKey.runner_up.points).toBe(15);
    expect(byKey.top_4_unordered.points).toBe(20);
    expect(byKey.top_4_ordered.points).toBe(20);
    expect(byKey.top_4_ordered.config).toEqual({ n: 4, exactBonus: 10 });
    expect(byKey.wooden_spoon.points).toBe(10);
    expect(byKey.stat_leader_runs.points).toBe(15);
    expect(byKey.stat_leader_wickets.points).toBe(15);
    expect(byKey.stat_leader_sixes.points).toBe(10);
    expect(byKey.numeric_guess.points).toBe(10);
    expect(byKey.yes_no.points).toBe(5);
  });

  it("generates one stat_leader template per statCategory the tournament declares, even unnamed ones", () => {
    const templates = buildDefaultQuestionTemplates({
      shortName: "T20 WC",
      config: { statCategories: ["runs", "catches"] },
    });
    const catches = templates.find((t) => t.key === "stat_leader_catches");
    expect(catches).toBeDefined();
    expect(catches?.type).toBe("stat_leader");
    expect(catches?.config).toEqual({ statCategory: "catches" });
    expect(catches?.points).toBe(10); // generic fallback, doc 01 §4.1's "custom" default
    expect(catches?.preChecked).toBe(true);
  });

  it("omits stat leaders entirely when the tournament declares no stat categories", () => {
    const templates = buildDefaultQuestionTemplates({ shortName: "Friendly Cup", config: {} });
    expect(templates.some((t) => t.type === "stat_leader")).toBe(false);
  });

  it("every generated question type is one the Session 3 scoring engine already knows, and none are 'custom'", () => {
    const types = buildDefaultQuestionTemplates(TOURNAMENT).map((t) => t.type);
    expect(types).not.toContain("custom");
    expect(types).not.toContain("team_over_under"); // needs an admin-picked team; not a default
  });
});
