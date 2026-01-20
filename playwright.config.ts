import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;
const fallbackSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || `http://127.0.0.1:${PORT}`;

const serverEnv = {
  PORT: `${PORT}`,
  E2E_TEST_MODE: "true",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321/mock",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "test-service-role-key",
  SUPABASE_URL: process.env.SUPABASE_URL || "http://127.0.0.1:54321/mock",
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "test-encryption-key-must-be-32-chars!!",
  NEXT_PUBLIC_SITE_URL: fallbackSiteUrl,
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
  NEXT_PUBLIC_E2E_TEST_MODE: "true",
  FORCE_MOCK_SUPABASE: "true",
  NEXT_TELEMETRY_DISABLED: "1",
};

const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND
  ? process.env.PLAYWRIGHT_WEB_SERVER_COMMAND
  : isCI
    ? `bun run start -- --hostname 0.0.0.0 --port ${PORT}`
    : `bun run dev -- --hostname 0.0.0.0 --port ${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: process.env.CI
    ? [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
        },
      ]
    : [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "firefox",
          use: { ...devices["Desktop Firefox"] },
        },
        {
          name: "webkit",
          use: { ...devices["Desktop Safari"] },
        },
      ],
  webServer: {
    command: webServerCommand,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: serverEnv,
  },
});
