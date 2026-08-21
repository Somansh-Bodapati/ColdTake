// Smoke test for the actual satori -> SVG -> resvg -> PNG pipeline (this
// session's brief, task 9: "full image-pixel testing isn't necessary" —
// this doesn't assert on pixels, just that the real Satori/resvg calls
// (fonts loaded, flexbox laid out, PNG rasterized) don't throw and produce
// a well-formed PNG). Every other *-card.test.ts in this folder tests the
// data -> element mapping without ever touching Satori itself.

import { describe, expect, it } from "vitest";
import { renderCardToPng, renderCardToSvg } from "@/lib/cards/render";
import { buildStandingsCardElement } from "@/lib/cards/standings-card";
import type { StandingsCardData } from "@/lib/cards/types";

const data: StandingsCardData = {
  groupName: "The Cool Group",
  joinUrl: "http://localhost:5173/join?code=ABC234",
  seasonName: "IPL 2027",
  isProjected: false,
  computedAt: "2027-05-01T00:00:00.000Z",
  standings: [{ rank: 1, displayName: "Somansh", points: 42, delta: 3 }],
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("card render pipeline", () => {
  it("renders a standings card to a well-formed, fully-sized SVG", async () => {
    // Satori draws every glyph as a vector path rather than an SVG <text>
    // node, so the rendered markup never contains the source strings
    // literally — reveal-card.test.ts etc. already prove the data -> text
    // mapping at the element-tree level, before Satori is involved. This
    // just proves the real satori call (fonts loaded, flexbox laid out)
    // succeeds and produces markup sized to the card's fixed dimensions.
    const svg = await renderCardToSvg(buildStandingsCardElement(data));
    expect(svg.startsWith('<svg width="1200" height="630"')).toBe(true);
    expect(svg).toContain("</svg>");
    expect(svg.length).toBeGreaterThan(500);
  });

  it("rasterizes to a well-formed PNG buffer", async () => {
    const png = await renderCardToPng(buildStandingsCardElement(data));
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(png.byteLength).toBeGreaterThan(1000);
  });
});
