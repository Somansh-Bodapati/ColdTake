// Golden-file regression test — doc 03 §2.6: "A golden-file test that
// scores a fixture season and diffs against a committed expected output.
// This catches regressions when you touch the engine." The fixture
// (seed/fixtures/golden-season.json) is a complete, realistic CPL 2026
// season: full 10-team tournament, a slate covering all 10 question types,
// picks from all 6 group members (including deliberate no-picks), and a
// final settled result. seed/fixtures/golden-season.expected.json was
// generated once by actually running `score()` over that fixture — see the
// generator note below — and is committed as the frozen baseline.
//
// File I/O lives here, in test code, not in src/lib/scoring/*.ts — the
// engine itself stays pure per CLAUDE.md rule 1.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { score } from "@/lib/scoring";
import type { Pick, Question, ResultSet, ScoringConfig, ScoringOutput } from "@/lib/scoring/types";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../seed/fixtures"
);

function readJson<T>(fileName: string): T {
  return JSON.parse(readFileSync(path.join(fixturesDir, fileName), "utf-8")) as T;
}

interface GoldenFixture {
  memberIds: string[];
  config: ScoringConfig;
  questions: Question[];
  picks: Pick[];
  results: ResultSet;
}

describe("golden file: golden-season", () => {
  it("scores the fixture season identically to the committed expected output", () => {
    const fixture = readJson<GoldenFixture>("golden-season.json");
    const expected = readJson<ScoringOutput>("golden-season.expected.json");

    const output = score({
      questions: fixture.questions,
      picks: fixture.picks,
      results: fixture.results,
      config: fixture.config,
      memberIds: fixture.memberIds,
      isProjected: false,
    });

    // If a deliberate engine change legitimately alters the golden output,
    // regenerate seed/fixtures/golden-season.expected.json with a small
    // one-off script: read golden-season.json the same way this test does,
    // call score() with isProjected: false, and JSON.stringify(output, null,
    // 2) + "\n" back into golden-season.expected.json. Never hand-edit the
    // expected file — always regenerate it from a real score() run so it
    // stays a true reflection of engine behavior.
    expect(output).toEqual(expected);
  });
});
