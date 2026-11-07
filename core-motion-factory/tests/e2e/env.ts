import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const E2E_PORT = Number(process.env.CMF_E2E_PORT ?? 3100);
/** Isolated database, Redis DB and data dir: E2E never touches development data. */
export const E2E_ENV: Record<string, string> = {
  DATABASE_URL: process.env.CMF_E2E_DATABASE_URL ?? "postgres://cmf:cmf@localhost:5432/cmf_e2e",
  REDIS_URL: process.env.CMF_E2E_REDIS_URL ?? "redis://localhost:6379/2",
  CMF_PUBLIC_URL: `http://localhost:${E2E_PORT}`,
  CMF_DATA_DIR: path.join(ROOT, ".data-e2e"),
  CMF_STORAGE_DRIVER: "local",
  CMF_STORAGE_SIGNING_SECRET: "e2e-signing-secret-0123456789abcdef",
  CMF_SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
  CMF_MODELS_DIR: path.join(ROOT, ".models"),
  CMF_ASR_PROVIDER: "sherpa-local",
  CMF_WORKER_CONCURRENCY: "1",
  CMF_LOG_LEVEL: "warn",
  CMF_SERVICE_NAME: "cmf-e2e",
  ...(process.env.CMF_CHROME_EXECUTABLE ? { CMF_CHROME_EXECUTABLE: process.env.CMF_CHROME_EXECUTABLE } : {}),
};
