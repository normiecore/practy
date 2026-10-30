import { defineConfig, devices } from "@playwright/test";
import { ADMIN_EMAIL, AUTH_STATE } from "./e2e/constants";

/**
 * Browser end-to-end tests against the built web app and a real API server with an in-memory
 * store and the development sign-in. `npm run test:e2e` builds the app and starts the server.
 */
const PORT = Number(process.env.PRACTY_E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE }, dependencies: ["setup"] },
  ],
  webServer: {
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
});
