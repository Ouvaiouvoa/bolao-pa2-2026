import { sql } from "drizzle-orm";
import { getDb } from "@cmf/db";
import { getPublisher } from "@cmf/orchestration";
import { publicRoute } from "@/lib/server/api";

export const dynamic = "force-dynamic";

export const GET = publicRoute(async () => {
  const checks: Record<string, string> = {};
  try {
    await getDb().execute(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "erro";
  }
  const redis = getPublisher();
  checks.redis = redis ? ((await redis.ping().catch(() => "erro")) === "PONG" ? "ok" : "erro") : "não configurado";
  return { status: Object.values(checks).every((v) => v === "ok") ? "ok" : "degradado", checks };
});
