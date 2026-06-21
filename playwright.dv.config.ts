import { defineConfig, devices } from "@playwright/test";
import { getLocalSupabaseEnv } from "./scripts/local-dev/dv-local-env.mjs";

const localSupabase = getLocalSupabaseEnv();
const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/dv",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `bunx next dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: localSupabase.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: localSupabase.anonKey,
      SUPABASE_SECRET_KEY: localSupabase.serviceRoleKey,
      NEXT_PUBLIC_TURNSTILE_BYPASS: "true",
      DV_TABROOM_LIVE: "0",
    },
  },
});
