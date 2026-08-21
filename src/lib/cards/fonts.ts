// Font loading for Satori (this session's brief, task 3: "any font used is
// loaded and passed as a buffer (inlined), not linked externally"). Satori
// has no access to a browser/OS font stack — every glyph it can lay out has
// to come from a font buffer handed to it explicitly per render call — so
// these two static TTFs (Inter Regular/Bold, SIL OFL 1.1, see
// src/lib/cards/assets/OFL.txt) are checked into the repo and read from
// disk once, not fetched over the network at request time.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const assetsDir = path.dirname(fileURLToPath(import.meta.url));

export interface CardFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

let cachedFonts: CardFont[] | undefined;

// Read once per process, not once per render — the two files together are
// under 700KB, but there's no reason to hit disk on every card request.
export function loadCardFonts(): CardFont[] {
  if (cachedFonts) {
    return cachedFonts;
  }
  cachedFonts = [
    {
      name: "Inter",
      data: readFileSync(path.join(assetsDir, "assets/Inter-Regular.ttf")),
      weight: 400,
      style: "normal",
    },
    {
      name: "Inter",
      data: readFileSync(path.join(assetsDir, "assets/Inter-Bold.ttf")),
      weight: 700,
      style: "normal",
    },
  ];
  return cachedFonts;
}
