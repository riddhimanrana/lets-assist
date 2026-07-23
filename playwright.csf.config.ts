import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

import { getCsfIsolatedSupabaseEnv } from "./scripts/local-dev/dv-local-env.mjs";

loadEnvConfig(process.cwd());

const localSupabase = getCsfIsolatedSupabaseEnv();
const port = Number(process.env.CSF_E2E_PORT ?? 3113);
const baseURL = process.env.CSF_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const artifactRoot = path.join(
  process.cwd(),
  "artifacts",
  "dvhs-csf-e2e",
  process.env.CSF_E2E_RUN_ID ?? "playwright-local",
  "playwright",
);

export default defineConfig({
  testDir: "./tests/csf",
  testMatch: "**/*.spec.ts",
  outputDir: path.join(artifactRoot, "test-results"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(artifactRoot, "html"), open: "never" }],
  ],
  use: {
    baseURL,
    actionTimeout: 12_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CSF_E2E_BASE_URL
    ? undefined
    : {
        command: `bunx next dev --hostname 127.0.0.1 --port ${port}`,
        url: `${baseURL}/login`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          ...process.env,
          NEXT_PUBLIC_SITE_URL: baseURL,
          GOOGLE_REDIRECT_URI: `${baseURL}/api/calendar/google/callback`,
          NEXT_PUBLIC_SUPABASE_URL: localSupabase.url,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: localSupabase.anonKey,
          SUPABASE_SECRET_KEY: localSupabase.serviceRoleKey,
          SUPABASE_DB_URL: localSupabase.dbUrl,
          NEXT_PUBLIC_TURNSTILE_BYPASS: "true",
          DV_TABROOM_LIVE: "0",
        },
      },
});
