// Shared plumbing for api/ handlers. Vercel Functions here use the
// Web-standard Request/Response (globally available since Node 18, no
// @vercel/node dependency needed) rather than the classic (req, res) style —
// it's the shape that's trivial to unit-test by constructing a Request
// directly and calling the handler, per doc 02 §"API routes: Vitest".

import type { ZodType } from "zod";
import { AppError } from "@/lib/errors";

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: HeadersInit } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

// Parses and Zod-validates a JSON request body. Throws AppError(400) on
// malformed JSON or a schema mismatch — every API boundary parses with Zod
// (CLAUDE.md code standards).
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError(400, "Request body must be valid JSON");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError(400, result.error.issues[0]?.message ?? "Invalid request body");
  }
  return result.data;
}

// Wraps a handler so a thrown AppError (or unexpected error) becomes a JSON
// error Response instead of an unhandled rejection reaching the runtime.
export function withErrorHandling(
  handler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof AppError) {
        return jsonResponse({ error: error.message }, { status: error.status });
      }
      console.error("Unhandled API error:", error);
      return jsonResponse({ error: "Internal server error" }, { status: 500 });
    }
  };
}
