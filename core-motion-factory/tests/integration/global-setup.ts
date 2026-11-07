import { rm } from "node:fs/promises";
import path from "node:path";
import { Redis } from "ioredis";
import pg from "pg";

export default async function setup() {
  await import("./env");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  const { runMigrations, closeDb } = await import("@cmf/db");
  await runMigrations();
  await closeDb();
  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
  await rm(path.resolve(process.env.CMF_DATA_DIR!), { recursive: true, force: true });
}
