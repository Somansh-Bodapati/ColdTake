// Vite plugin that serves the src/server/**/*.ts API handlers from inside
// the same dev server process as the frontend, so `pnpm dev` gives you a
// working `/api/...` for the deployed frontend code's `fetch("/api/...")`
// calls to hit locally (previously api/ handlers were only ever invoked
// from tests constructing a Request by hand).
//
// Only registered via `configureServer`, which Vite calls in dev/serve mode
// only — never during `vite build` — so this has zero effect on the
// production build output.
//
// Routing comes from src/server/router.ts's `matchRoute` — the exact same
// route table the production catch-all Function (api/gateway.ts) uses, so
// local dev and production share one single source of truth and can't
// drift apart. The module is loaded once via `server.ssrLoadModule` (Vite's
// own module graph, so the `@/*` -> `./src/*` tsconfig path alias resolves
// correctly) rather than per-request — edits to src/server/ files are still
// picked up on the next request because ssrLoadModule reads through Vite's
// module graph, which invalidates on file change regardless of when the
// module was first loaded.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        headers.append(key, v);
      }
    } else {
      headers.append(key, value);
    }
  }

  const method = req.method ?? "GET";
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    if (chunks.length > 0) {
      body = Buffer.concat(chunks);
    }
  }

  return new Request(url, {
    method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });
}

async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === "set-cookie") {
      continue;
    }
    res.setHeader(key, value);
  }
  if (setCookies.length > 0) {
    res.setHeader("set-cookie", setCookies);
  }
  res.statusCode = response.status;

  if (!response.body) {
    res.end();
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

type RouterModule = {
  matchRoute: (pathname: string) => { handler: (request: Request) => Promise<Response> } | null;
};

function isRouterModule(mod: unknown): mod is RouterModule {
  return (
    typeof mod === "object" &&
    mod !== null &&
    "matchRoute" in mod &&
    typeof (mod as { matchRoute: unknown }).matchRoute === "function"
  );
}

function createMiddleware(server: ViteDevServer): Connect.NextHandleFunction {
  return function apiDevMiddleware(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }

    void (async () => {
      try {
        const mod = await server.ssrLoadModule("/src/server/router.ts");
        if (!isRouterModule(mod)) {
          throw new Error("src/server/router.ts has no matchRoute export");
        }
        const match = mod.matchRoute(url.pathname);
        if (!match) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        const webRequest = await toWebRequest(req);
        const webResponse = await match.handler(webRequest);
        await writeWebResponse(webResponse, res);
      } catch (error) {
        server.ssrFixStacktrace(error as Error);
        console.error("[api-dev-server] handler error:", error);
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    })();
  };
}

export function apiDevServer(): Plugin {
  return {
    name: "coldtake-api-dev-server",
    configureServer(server) {
      const middleware = createMiddleware(server);
      // Register before Vite's own middlewares (e.g. the SPA/history
      // fallback and react-router's request handler) so /api/* never falls
      // through to the frontend router.
      server.middlewares.use(middleware);
    },
  };
}
