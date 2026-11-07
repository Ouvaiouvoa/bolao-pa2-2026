import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: Db | null = null;

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  return url;
}

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: databaseUrl(), max: Number(process.env.CMF_DB_POOL_MAX ?? 10) });
  return pool;
}

export function getDb(): Db {
  db ??= drizzle(getPool(), { schema });
  return db;
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  db = null;
}

/** Runs `fn` inside a transaction. */
export async function tx<T>(fn: (trx: Db) => Promise<T>): Promise<T> {
  return getDb().transaction(async (trx) => fn(trx as unknown as Db));
}
