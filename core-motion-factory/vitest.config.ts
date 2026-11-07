import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "packages/*/src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 600_000,
          hookTimeout: 600_000,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          globalSetup: ["tests/integration/global-setup.ts"],
        },
      },
      {
        test: {
          name: "visual",
          include: ["tests/visual/**/*.test.ts"],
          environment: "node",
          testTimeout: 600_000,
          hookTimeout: 600_000,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
