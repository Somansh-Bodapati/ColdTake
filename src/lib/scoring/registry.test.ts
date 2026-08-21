import { describe, expect, it } from "vitest";
import { createResolverRegistry } from "@/lib/scoring/registry";
import { championResolver } from "@/lib/scoring/resolvers/champion";
import { topNUnorderedResolver } from "@/lib/scoring/resolvers/top-n-unordered";

describe("createResolverRegistry", () => {
  it("looks resolvers up by their type", () => {
    const registry = createResolverRegistry([championResolver, topNUnorderedResolver]);
    const result = registry.get("champion");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(championResolver);
    }
  });

  it("returns a typed error for an unregistered type", () => {
    const registry = createResolverRegistry([championResolver]);
    const result = registry.get("numeric");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe("numeric");
    }
  });

  it("register() adds a resolver after construction", () => {
    const registry = createResolverRegistry();
    registry.register(championResolver);
    expect(registry.get("champion").ok).toBe(true);
  });
});
