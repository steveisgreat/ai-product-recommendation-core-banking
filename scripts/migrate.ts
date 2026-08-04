/**
 * scripts/migrate.ts
 *
 * Runs all SQL migration files against the database specified by DATABASE_URL.
 * Loads .env.local automatically so this can be run locally without exporting
 * environment variables manually.
 *
 * Usage:
 *   pnpm migrate
 *
 * Environment:
 *   DATABASE_URL  — Postgres connection string (required)
 */

import { readFileSync } from "fs";
import { join } from "path";
import { config } from "dotenv";
import postgres from "postgres";

// Load .env.local (silently skipped if the file does not exist, e.g. in CI
// where the variable is injected directly into the environment).
config({ path: join(process.cwd(), ".env.local") });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "ERROR: DATABASE_URL environment variable is not set.\n" +
      "       Add it to .env.local or export it before running pnpm migrate."
  );
  process.exit(1);
}

const MIGRATIONS_DIR = join(process.cwd(), "migrations");
const MIGRATION_FILES = ["001_initial_schema.sql"];

async function runMigrations(): Promise<void> {
  const sql = postgres(DATABASE_URL as string, {
    // Raise a hard error on connection failure rather than retrying indefinitely.
    max: 1,
    connect_timeout: 10,
  });

  try {
    for (const file of MIGRATION_FILES) {
      const filePath = join(MIGRATIONS_DIR, file);
      console.log(`Running migration: ${file}`);

      let migrationSql: string;
      try {
        migrationSql = readFileSync(filePath, "utf-8");
      } catch (readErr) {
        throw new Error(`Could not read migration file "${filePath}": ${readErr}`);
      }

      await sql.unsafe(migrationSql);
      console.log(`  ✓ ${file} applied successfully`);
    }

    console.log("\nAll migrations completed successfully.");
  } finally {
    await sql.end();
  }
}

runMigrations().catch((err: unknown) => {
  console.error("\nMigration failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
