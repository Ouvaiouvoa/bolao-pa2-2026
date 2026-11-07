import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../../infra/migrations");

export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: MIGRATIONS_DIR });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(async () => {
      process.stderr.write("migrations applied\n");
      await closeDb();
    })
    .catch(async (err) => {
      process.stderr.write(`migration failed: ${(err as Error).message}\n`);
      await closeDb();
      process.exit(1);
    });
}
