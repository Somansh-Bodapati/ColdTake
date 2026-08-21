// Reproduces Vercel's actual deploy/runtime behavior for the api/gateway.ts
// Serverless Function, which Vite/Vitest/tsx never do: Vercel transpiles each
// .ts file to .js individually (types stripped, import specifiers left
// untouched) and lets Node's native ESM loader resolve the result under
// /var/task — and that loader requires explicit file extensions on relative
// specifiers. This script:
//
//   1. Walks the import graph starting at api/gateway.ts (relative imports
//      only, exactly like Vercel sees it) and collects every reachable file.
//   2. Transpiles each one (types stripped only, via the TypeScript compiler
//      API's transpileModule — no bundling, no path rewriting) into a scratch
//      directory, preserving the relative directory structure, mirroring
//      Vercel's per-file compilation.
//   3. Actually `import()`s the compiled api/gateway.js under plain Node
//      and fails loudly on ERR_MODULE_NOT_FOUND (or any other resolution
//      error) — the only way to catch what static/type checks and bundler
//      based tools (which auto-resolve extensionless specifiers) cannot.
//
// Usage: node scripts/verify-vercel-function.mjs
// Exit code 0 = passed, 1 = failed to resolve/import.

import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRATCH_DIR = path.join(ROOT, "node_modules", ".verify-vercel-function");
const ENTRY = path.join(ROOT, "api/gateway.ts");

const IMPORT_RE =
  /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** Resolve a relative or @/-aliased specifier to an absolute source file, or null. */
function resolveSpecifier(fromFile, specifier) {
  // Specifiers in this codebase are already .js-suffixed (that's the fix
  // under test), but the actual source on disk is .ts/.tsx — strip a
  // trailing .js before resolving against the source tree.
  const withoutJsExt = specifier.replace(/\.js$/, "");

  let basePath;
  if (withoutJsExt.startsWith("@/")) {
    basePath = path.join(ROOT, "src", withoutJsExt.slice(2));
  } else if (withoutJsExt.startsWith(".")) {
    basePath = path.join(path.dirname(fromFile), withoutJsExt);
  } else {
    return null; // bare package import — resolved via node_modules, untouched
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function findReachableFiles(entry) {
  const visited = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);

    const content = readFileSync(file, "utf8");
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(content))) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const resolved = resolveSpecifier(file, specifier);
      if (resolved && !visited.has(resolved)) queue.push(resolved);
    }
  }

  return visited;
}

function transpileTree(files) {
  rmSync(SCRATCH_DIR, { recursive: true, force: true });
  mkdirSync(SCRATCH_DIR, { recursive: true });

  for (const absFile of files) {
    const relFile = path.relative(ROOT, absFile);
    const source = readFileSync(absFile, "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        verbatimModuleSyntax: true,
      },
      fileName: absFile,
    });

    const outRel = relFile.replace(/\.tsx?$/, ".js");
    const outAbs = path.join(SCRATCH_DIR, outRel);
    mkdirSync(path.dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, outputText, "utf8");
  }
}

async function runEntryPoint() {
  const entryOutAbs = path.join(
    SCRATCH_DIR,
    path.relative(ROOT, ENTRY).replace(/\.tsx?$/, ".js"),
  );

  process.env.DATABASE_URL ??= "postgresql://verify:verify@localhost:5432/verify_dummy";
  process.env.DB_DRIVER ??= "node-postgres";

  const mod = await import(pathToFileURL(entryOutAbs).href);
  // Vercel's Node runtime treats a *bare* default function export as its
  // legacy (req: IncomingMessage, res: ServerResponse) convention, not a Web
  // handler — that mismatch is exactly what caused the production
  // "Invalid URL" / "headers.get is not a function" crashes. The correct,
  // zero-config contract for a Web `Request` on every method is the "fetch
  // Web Standard export": `export default { fetch(request) }`. Assert that
  // shape here so a regression back to a bare default function fails this
  // harness instead of only surfacing on a real Vercel deploy.
  if (typeof mod.default !== "object" || mod.default === null) {
    throw new Error(
      "api/gateway.js's default export must be an object ({ fetch }), not a bare function — " +
        "a bare default function is Vercel's legacy (req, res) handler contract, not a Web handler.",
    );
  }
  if (typeof mod.default.fetch !== "function") {
    throw new Error("api/gateway.js's default export is missing a `fetch` function");
  }
  return mod;
}

async function main() {
  console.log(`Walking import graph from ${path.relative(ROOT, ENTRY)}...`);
  const files = findReachableFiles(ENTRY);
  console.log(`Found ${files.size} reachable files. Transpiling (types stripped only)...`);
  transpileTree(files);

  console.log("Importing compiled api/gateway.js under plain Node (real ESM resolution)...");
  await runEntryPoint();
  console.log("OK: module graph resolved and imported with zero ERR_MODULE_NOT_FOUND errors.");
}

main()
  .then(() => {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((error) => {
    console.error("FAILED:", error?.stack ?? error);
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
    process.exit(1);
  });
