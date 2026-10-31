import { defineConfig, devices } from "@playwright/test";
import { ADMIN_EMAIL, AUTH_STATE } from "./e2e/constants";

/**
 * Browser end-to-end tests against the built web app and a real API server with an in-memory
 * store and the development sign-in. `npm run test:e2e` builds the app and starts the server,
 * then starts the sample firm from `npm run demo` on the next port for e2e/demo.spec.ts.
 */
const PORT = Number(process.env.PRACTY_E2E_PORT ?? 3100);
const DEMO_PORT = Number(process.env.PRACTY_E2E_DEMO_PORT ?? PORT + 1);
const baseURL = `http://localhost:${PORT}`;
const demoURL = `http://localhost:${DEMO_PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE }, dependencies: ["setup"], testIgnore: [/mobile(-[\w-]+)?\.spec\.ts/, /demo\.spec\.ts/] },
    // iPhone screen size and touch, rendered with Chromium (the only browser CI installs).
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium", storageState: AUTH_STATE }, dependencies: ["setup"], testMatch: /mobile(-[\w-]+)?\.spec\.ts/ },
    // The sample firm (`npm run demo`) on its own server; each test signs in as the demo principal.
    { name: "demo", use: { ...devices["Desktop Chrome"], baseURL: demoURL }, testMatch: /demo\.spec\.ts/ },
  ],
  // Started in order, so the demo server finds the web app the first server's command built.
  webServer: [
    {
      command: "npx vite build && npx tsx src/server/main.ts",
      url: `${baseURL}/auth/providers`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        PORT: String(PORT),
        PRACTY_BASE_URL: baseURL,
        PRACTY_DEV_LOGIN: "1",
        PRACTY_BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
        PRACTY_JOBS: "0",
        DATABASE_URL: "",
      },
    },
    {
      command: "npx tsx src/server/demo-main.ts",
      url: `${demoURL}/auth/providers`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // SIGTERM lets the demo remove its temporary documents folder.
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      env: { PORT: String(DEMO_PORT), PRACTY_BASE_URL: demoURL, DATABASE_URL: "" },
    },
  ],
});
