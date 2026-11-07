import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
/** Isolated infrastructure for integration tests (never the development database). */
Object.assign(process.env, {
  DATABASE_URL: process.env.CMF_IT_DATABASE_URL ?? "postgres://cmf:cmf@localhost:5432/cmf_it",
  REDIS_URL: process.env.CMF_IT_REDIS_URL ?? "redis://localhost:6379/3",
  CMF_DATA_DIR: path.join(ROOT, ".data-it"),
  CMF_STORAGE_DRIVER: "local",
  CMF_STORAGE_SIGNING_SECRET: "it-signing-secret-0123456789abcdef",
  CMF_PUBLIC_URL: "http://localhost:3999",
  CMF_MODELS_DIR: process.env.CMF_MODELS_DIR ?? path.join(ROOT, ".models"),
  CMF_LOG_LEVEL: "warn",
});
