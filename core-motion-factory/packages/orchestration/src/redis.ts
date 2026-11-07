import { Redis } from "ioredis";

let publisher: Redis | null = null;
let disabled = false;

export function redisUrl(): string | null {
  return process.env.REDIS_URL ?? null;
}

/** Shared connection used for pub/sub notifications (null when Redis is not configured). */
export function getPublisher(): Redis | null {
  if (disabled) return null;
  const url = redisUrl();
  if (!url) return null;
  publisher ??= new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false, enableOfflineQueue: true });
  publisher.on("error", () => undefined);
  return publisher;
}

/** Creates a dedicated subscriber connection (pub/sub connections cannot issue other commands). */
export function createSubscriber(): Redis | null {
  const url = redisUrl();
  if (!url) return null;
  const sub = new Redis(url, { maxRetriesPerRequest: null });
  sub.on("error", () => undefined);
  return sub;
}

/** BullMQ connection options (BullMQ creates its own connections; maxRetriesPerRequest must be null). */
export function redisConnectionOptions(): { host: string; port: number; username?: string; password?: string; db: number; tls?: object; maxRetriesPerRequest: null } {
  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL não configurada");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: Number(u.pathname.replace("/", "") || 0),
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

export async function closeRedis(): Promise<void> {
  if (publisher) await publisher.quit().catch(() => undefined);
  publisher = null;
}

export function disableRedisForTests(): void {
  disabled = true;
}
