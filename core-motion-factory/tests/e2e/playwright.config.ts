import { defineConfig } from "@playwright/test";
import { E2E_ENV, E2E_PORT, ROOT } from "./env";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 30 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: `${ROOT}/playwright-report`, open: "never" }]],
  globalSetup: "./global-setup.ts",
  outputDir: `${ROOT}/test-results`,
  use: { baseURL: `http://localhost:${E2E_PORT}`, viewport: { width: 1440, height: 1000 }, trace: "off", screenshot: "only-on-failure", acceptDownloads: true },
  webServer: [
    {
      command: `npx next start -p ${E2E_PORT}`,
      cwd: `${ROOT}/apps/web`,
      url: `http://localhost:${E2E_PORT}/api/health`,
      env: E2E_ENV,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: "npx tsx apps/worker/src/main.ts",
      cwd: ROOT,
      env: { ...E2E_ENV, CMF_LOG_LEVEL: "info" },
      // The worker has no HTTP port; Playwright waits for its structured start log.
      wait: { stderr: /worker\.start/ },
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
