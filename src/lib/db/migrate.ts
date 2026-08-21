// Runs pending migrations from src/lib/db/migrations against DATABASE_URL.
// Uses `pg` directly (not the driver-swap client in client.ts) because
// drizzle-orm's migrator needs a plain node-postgres connection regardless
// of which driver serves runtime queries; migrations only ever run from a
// trusted environment with a direct Postgres connection, never from the
// edge/serverless request path.

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Missing required env var: DATABASE_URL");
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });
  console.log("Migrations complete.");

  await pool.end();
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
