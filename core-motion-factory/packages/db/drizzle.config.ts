import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema.ts",
  out: "./infra/migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://cmf:cmf@localhost:5432/cmf" },
});
