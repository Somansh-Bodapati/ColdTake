// Driver swap point (docs/DECISIONS.md: no Neon account yet, local dev runs
// against Postgres directly). Set DB_DRIVER=neon in production/deploy envs
// to route through @neondatabase/serverless's HTTP driver instead of `pg`;
// everywhere else (local dev, tests against the Docker/Homebrew Postgres)
// this defaults to drizzle-orm/node-postgres, which speaks the wire
// protocol Neon's HTTP driver can't use against a plain local Postgres.
//
// Both branches return the same drizzle-orm query builder typed against
// `schema`, so `src/lib/db/queries/*` never needs to know which driver is
// live.

import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";
import * as schema from "./schema";

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
    const sql = neon(databaseUrl);
    return drizzleNeon({ client: sql, schema });
  }

  const pool = new Pool({ connectionString: databaseUrl });
  return drizzleNodePostgres({ client: pool, schema });
}

export const db = createDb();
