import { defineConfig, devices } from "@playwright/test";

const PORT = 5199;
const recording = !!process.env.RECORD;
const benchmarking = !!process.env.BENCH;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: !benchmarking,
  workers: benchmarking ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    recording
      ? { name: "record", testMatch: /record\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }
      : benchmarking
        ? { name: "bench", testMatch: /bench\.spec\.ts/, use: { ...devices["Desktop Chrome"] } }
        : { name: "chromium", testIgnore: /(record|bench)\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
