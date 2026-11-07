import { rm } from "node:fs/promises";
import { Redis } from "ioredis";
import pg from "pg";
import { E2E_ENV } from "./env";

/** Fresh schema + empty queue before every E2E run (isolated from development data). */
export default async function globalSetup() {
  const client = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  Object.assign(process.env, E2E_ENV);
  const { runMigrations, closeDb } = await import("@cmf/db");
  await runMigrations();
  await closeDb();
  const redis = new Redis(E2E_ENV.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
  await rm(E2E_ENV.CMF_DATA_DIR!, { recursive: true, force: true });
}
