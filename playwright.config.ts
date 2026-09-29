import { defineConfig, devices } from "@playwright/test";

const port = 3000;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /\.serial\.spec\.ts$/ },
    // Tests that read global state (the pending count behind the Admin's
    // bell) run alone, after every other test has finished.
    {
      name: "serial",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /\.serial\.spec\.ts$/,
      dependencies: ["chromium"],
    },
  ],
  // Runs against a production build. `npm run build` must run first.
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
