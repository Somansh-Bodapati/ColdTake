// Vite plugin that serves the api/**/*.ts Vercel Functions from inside the
// same dev server process as the frontend, so `pnpm dev` gives you a
// working `/api/...` for the deployed frontend code's `fetch("/api/...")`
// calls to hit locally (previously api/ handlers were only ever invoked
// from tests constructing a Request by hand).
//
// Only registered via `configureServer`, which Vite calls in dev/serve mode
// only — never during `vite build` — so this has zero effect on the
// production build output.
//
// Routing mirrors Vercel's file-based convention under api/:
//   /api/me                       -> api/me.ts
//   /api/groups                   -> api/groups/index.ts
//   /api/groups/join              -> api/groups/join.ts
//   /api/groups/:id               -> api/groups/[id]/index.ts
//   /api/groups/:id/members/:mid  -> api/groups/[id]/members/[memberId].ts
// Bracketed segments ([id], [tournamentId], ...) match any single path
// segment; static segments are preferred over dynamic ones when both could
// match (e.g. /api/groups/join matches groups/join.ts, not
// groups/[id]/index.ts), matching Vercel/Next.js precedence.
//
// Each handler file is loaded through `server.ssrLoadModule`, i.e. Vite's
// own module graph — the same resolution the frontend already gets, so the
// `@/*` -> `./src/*` tsconfig path alias (vite.config.ts's
// `resolve.tsconfigPaths`) resolves correctly. Because ssrLoadModule reads
// through the module graph on every call, edits to api/ files are picked up
// on the next request without restarting the dev server.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin, ViteDevServer } from "vite";

const API_DIR = "api";

interface RouteNode {
  file?: string; // path relative to API_DIR, no extension, e.g. "groups/[id]/index"
  literalChildren: Map<string, RouteNode>;
  dynamicChild?: RouteNode;
}

function createNode(): RouteNode {
  return { literalChildren: new Map() };
}

// Recursively walks the api/ directory collecting every *.ts file (skipping
// *.test.ts) as a route, relative to API_DIR with the extension stripped.
function collectRouteFiles(rootDir: string, dir: string = rootDir, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectRouteFiles(rootDir, fullPath, out);
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) {
      continue;
    }
    const relative = fullPath
      .slice(rootDir.length + 1)
      .replace(/\\/g, "/")
      .replace(/\.ts$/, "");
    out.push(relative);
  }
  return out;
}

function buildRouteTree(rootDir: string): RouteNode {
  const root = createNode();
  for (const relative of collectRouteFiles(rootDir)) {
    const parts = relative.split("/");
    if (parts[parts.length - 1] === "index") {
      parts.pop();
    }
    let node = root;
    for (const part of parts) {
      const isDynamic = part.startsWith("[") && part.endsWith("]");
      if (isDynamic) {
        node.dynamicChild ??= createNode();
        node = node.dynamicChild;
      } else {
        let child = node.literalChildren.get(part);
        if (!child) {
          child = createNode();
          node.literalChildren.set(part, child);
        }
        node = child;
      }
    }
    node.file = relative;
  }
  return root;
}

// Matches request path segments against the route tree, preferring literal
// matches over dynamic ones at each level, with backtracking.
function matchRoute(node: RouteNode, segments: string[], index: number): string | undefined {
  if (index === segments.length) {
    return node.file;
  }
  const segment = segments[index];
  const literalChild = node.literalChildren.get(segment);
  if (literalChild) {
    const match = matchRoute(literalChild, segments, index + 1);
    if (match) {
      return match;
    }
  }
  if (node.dynamicChild) {
    const match = matchRoute(node.dynamicChild, segments, index + 1);
    if (match) {
      return match;
    }
  }
  return undefined;
}

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

type ApiHandlerModule = { default: (request: Request) => Promise<Response> };

function isApiHandlerModule(mod: unknown): mod is ApiHandlerModule {
  return (
    typeof mod === "object" &&
    mod !== null &&
    "default" in mod &&
    typeof (mod as { default: unknown }).default === "function"
  );
}

function createMiddleware(server: ViteDevServer, apiRootAbs: string): Connect.NextHandleFunction {
  const routeTree = buildRouteTree(apiRootAbs);

  return function apiDevMiddleware(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }

    const segments = url.pathname
      .slice("/api/".length)
      .split("/")
      .filter(Boolean);
    const matchedFile = matchRoute(routeTree, segments, 0);

    if (!matchedFile) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    void (async () => {
      try {
        const modulePath = `/${API_DIR}/${matchedFile}.ts`;
        const mod = await server.ssrLoadModule(modulePath);
        if (!isApiHandlerModule(mod)) {
          throw new Error(`${modulePath} has no default export function`);
        }
        const webRequest = await toWebRequest(req);
        const webResponse = await mod.default(webRequest);
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
      const apiRootAbs = join(server.config.root, API_DIR);
      const middleware = createMiddleware(server, apiRootAbs);
      // Register before Vite's own middlewares (e.g. the SPA/history
      // fallback and react-router's request handler) so /api/* never falls
      // through to the frontend router.
      server.middlewares.use(middleware);
    },
  };
}
