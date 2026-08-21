// Resolver registry — doc 03 §2.2: "Register resolvers in a map keyed by
// type. Adding a new question type = adding one file. No changes to the
// engine." Pure: just a Map wrapper, no I/O.

import type { QuestionType } from "../db/schema.js";
import type { QuestionResolver, Result } from "./types.js";

export interface UnknownResolverError {
  code: "unknown_resolver";
  message: string;
  type: QuestionType;
}

export interface ResolverRegistry {
  register(resolver: QuestionResolver): void;
  get(type: QuestionType): Result<QuestionResolver, UnknownResolverError>;
}

export function createResolverRegistry(
  resolvers: readonly QuestionResolver[] = []
): ResolverRegistry {
  const byType = new Map<QuestionType, QuestionResolver>();
  for (const resolver of resolvers) {
    byType.set(resolver.type, resolver);
  }

  return {
    register(resolver) {
      byType.set(resolver.type, resolver);
    },
    get(type) {
      const resolver = byType.get(type);
      if (!resolver) {
        return {
          ok: false,
          error: {
            code: "unknown_resolver",
            message: `No resolver registered for question type "${type}".`,
            type,
          },
        };
      }
      return { ok: true, value: resolver };
    },
  };
}
