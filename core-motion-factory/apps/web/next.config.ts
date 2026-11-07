import path from "node:path";
import type { NextConfig } from "next";

const root = path.resolve(import.meta.dirname, "../..");
// Load the monorepo .env (secrets come from the environment vault in production).
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  /* optional */
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@cmf/schemas", "@cmf/db", "@cmf/storage", "@cmf/observability", "@cmf/orchestration", "@cmf/brand-engine", "@cmf/templates", "@cmf/remotion"],
  serverExternalPackages: ["pg", "bullmq", "ioredis", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
  turbopack: { root },
  outputFileTracingRoot: root,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
