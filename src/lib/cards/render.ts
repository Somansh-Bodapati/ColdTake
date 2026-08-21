// Satori -> SVG -> PNG pipeline (docs/02-TECH-STACK-OPTIONS.md §6:
// "Satori... only produces SVG" — @resvg/resvg-js does the SVG -> PNG
// rasterization step Satori itself doesn't do). The only place in the
// codebase that imports `satori` or `@resvg/resvg-js` directly; every card
// route calls this with an already-built element tree, never satori itself.

import satori from "satori";
import type { ReactNode } from "react";
import { Resvg } from "@resvg/resvg-js";
import { CARD_HEIGHT, CARD_WIDTH, type CardElement } from "./element.js";
import { loadCardFonts } from "./fonts.js";

// Satori's public signature takes `ReactNode` because it's normally fed a
// real JSX tree, but it only ever inspects `.type`/`.props.style`/
// `.props.children` at runtime — this codebase builds that exact shape by
// hand (src/lib/cards/element.ts) without depending on React's JSX runtime,
// so this cast just crosses the type boundary between "the shape satori
// actually reads" and "the type its .d.ts declares for JSX callers."
export async function renderCardToSvg(root: CardElement): Promise<string> {
  return satori(root as unknown as ReactNode, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: loadCardFonts(),
  });
}

export async function renderCardToPng(root: CardElement): Promise<Buffer> {
  const svg = await renderCardToSvg(root);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_WIDTH },
  });
  return resvg.render().asPng();
}
