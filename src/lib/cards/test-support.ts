// Shared test helper for the four card-element test files — walks a
// CardElement tree and concatenates every string leaf, so a test can assert
// "this text appears somewhere on the card" without hand-walking the tree
// itself. Not a barrel file (CLAUDE.md: no index.ts re-exports) — this is
// the helper itself, only ever imported by *.test.ts in this folder.

import type { CardElement } from "@/lib/cards/element";

export function flattenText(node: CardElement): string {
  const children = node.props.children;
  if (children === undefined) return "";
  const list = Array.isArray(children) ? children : [children];
  return list
    .map((child) => (typeof child === "string" ? child : flattenText(child)))
    .join(" ");
}
