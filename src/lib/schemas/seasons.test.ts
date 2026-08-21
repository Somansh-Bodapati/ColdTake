import { describe, expect, it } from "vitest";
import { createSeasonRequestSchema, questionInputSchema } from "./seasons";

describe("questionInputSchema", () => {
  it("accepts a champion question with empty config", () => {
    const result = questionInputSchema.safeParse({
      type: "champion",
      prompt: "Who wins?",
      config: {},
      points: 25,
    });
    expect(result.success).toBe(true);
  });

  it("rejects top_n_unordered without config.n", () => {
    const result = questionInputSchema.safeParse({
      type: "top_n_unordered",
      prompt: "Top 4?",
      config: {},
      points: 20,
    });
    expect(result.success).toBe(false);
  });

  it("defaults settlement to auto for champion and manual for numeric", () => {
    const champion = questionInputSchema.parse({
      type: "champion",
      prompt: "Who wins?",
      config: {},
      points: 25,
    });
    const numeric = questionInputSchema.parse({
      type: "numeric",
      prompt: "Total sixes?",
      config: {},
      points: 10,
    });
    expect(champion.settlement).toBe("auto");
    expect(numeric.settlement).toBe("manual");
  });

  it("the custom question builder rejects fewer than 2 options", () => {
    const result = questionInputSchema.safeParse({
      type: "custom",
      prompt: "Who wears the funniest hat?",
      config: { options: [{ id: "a", label: "Priya" }] },
      points: 10,
    });
    expect(result.success).toBe(false);
  });

  it("the custom question builder accepts a well-formed multiple choice question", () => {
    const result = questionInputSchema.safeParse({
      type: "custom",
      prompt: "Who wears the funniest hat?",
      config: {
        options: [
          { id: "priya", label: "Priya" },
          { id: "arjun", label: "Arjun" },
        ],
      },
      points: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown question type", () => {
    const result = questionInputSchema.safeParse({
      type: "trivia",
      prompt: "?",
      config: {},
      points: 10,
    });
    expect(result.success).toBe(false);
  });
});

describe("createSeasonRequestSchema", () => {
  it("defaults questions to an empty array", () => {
    const parsed = createSeasonRequestSchema.parse({
      groupId: "group-1",
      tournamentId: "cpl-2026",
    });
    expect(parsed.questions).toEqual([]);
  });

  it("requires groupId and tournamentId", () => {
    expect(createSeasonRequestSchema.safeParse({ tournamentId: "cpl-2026" }).success).toBe(false);
    expect(createSeasonRequestSchema.safeParse({ groupId: "group-1" }).success).toBe(false);
  });
});
