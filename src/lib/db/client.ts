// Driver swap point (docs/DECISIONS.md: no Neon account yet, local dev runs
// against Postgres directly). Set DB_DRIVER=neon in production/deploy envs
// to route through @neondatabase/serverless instead of `pg`; everywhere
// else (local dev, tests against the Docker/Homebrew Postgres) this
// defaults to drizzle-orm/node-postgres, which speaks the wire protocol a
// plain local Postgres needs.
//
// The Neon branch uses neon-serverless's WebSocket-backed Pool, NOT
// neon-http -- a real production incident tonight: neon-http has NO
// transaction support at all ("No transactions support in neon-http
// driver"), and both src/lib/picks/service.ts and src/lib/groups/service.ts
// wrap multi-table writes in db.transaction() for atomicity (pick + its
// pick_history row; group + its founding admin member). That worked in
// every local/test run (node-postgres supports transactions) and crashed
// immediately in production on the first real pick submission. Neon's own
// WebSocket Pool supports interactive transactions identically to a normal
// Postgres connection -- it just needs a WebSocket implementation, since
// Node's runtime here (whichever version Vercel's project settings pin)
// isn't guaranteed to have a stable native `WebSocket` global; `ws` is
// Neon's own documented, version-agnostic way to supply one.
//
// Both branches return the same drizzle-orm query builder typed against
// `schema`, so `src/lib/db/queries/*` never needs to know which driver is
// live.

import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { Pool } from "pg";
import ws from "ws";
import * as schema from "./schema.js";

neonConfig.webSocketConstructor = ws;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function createDb() {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const useNeon = process.env.DB_DRIVER === "neon";

  if (useNeon) {
    const pool = new NeonPool({ connectionString: databaseUrl });
    return drizzleNeon({ client: pool, schema });
  }

  const pool = new Pool({ connectionString: databaseUrl });
  return drizzleNodePostgres({ client: pool, schema });
}

export const db = createDb();
