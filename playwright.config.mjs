import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const parsedWorkers = Number(process.env.PLAYWRIGHT_WORKERS);
const workerLimit = Number.isFinite(parsedWorkers) && parsedWorkers > 0 ? parsedWorkers : process.env.CI ? 2 : undefined;
const webServerEnabled = process.env.PLAYWRIGHT_WEB_SERVER === "true";
const webServerPort = new URL(baseURL).port || "3000";

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.mjs",
  timeout: 90_000,
  workers: workerLimit,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    headless: true
  },
  webServer: webServerEnabled
    ? {
        command: `npm run start -- -p ${webServerPort}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      }
    : undefined
});
