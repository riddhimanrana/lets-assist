import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import {
  CSF_ISOLATED_APP_PORT,
  getCsfIsolatedSupabaseEnv,
  loadCsfIsolatedAppEnvironment,
} from "./scripts/local-dev/dv-local-env.mjs";

// Do not capture authentication form values in Playwright error-context snapshots.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

if (process.env.ATTENDANCE_HOSTED_DEVELOPMENT !== undefined)
  throw new Error("Use the separate guarded hosted attendance configuration.");

// This suite attaches only when a caller explicitly owns the already-running app.
if (process.env.ATTENDANCE_EXISTING_SERVER !== "1")
  throw new Error(
    "Start the owned isolated app, then set ATTENDANCE_EXISTING_SERVER=1.",
  );
getCsfIsolatedSupabaseEnv();
loadCsfIsolatedAppEnvironment(process.env.CSF_ISOLATED_WORK_DIR);

export default defineConfig({
  testDir: "./tests/e2e/attendance",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 360_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  outputDir: path.join(
    process.cwd(),
    ".artifacts",
    "attendance-e2e",
    process.env.ATTENDANCE_E2E_RUN_ID ?? "local",
  ),
  use: {
    baseURL: `http://localhost:${CSF_ISOLATED_APP_PORT}`,
    navigationTimeout: 120_000,
    actionTimeout: 20_000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
