import { readFileSync } from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

import {
  CSF_ISOLATED_APP_PORT,
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
} from "./scripts/local-dev/dv-local-env.mjs";

loadEnvConfig(process.cwd());

// Live status/credential validation bound to the selected isolated stack. The
// browser child gets its Supabase values from the runner's own validated app
// environment rather than from here, so nothing is bound: this call exists to
// refuse a stopped, mismatched, or ambient stack before a single test starts.
getCsfIsolatedSupabaseEnv();
const isolatedStack = inspectCsfIsolatedWorkDir(
  process.env.CSF_ISOLATED_WORK_DIR,
);
const profileClaimSecret = readFileSync(
  path.join(isolatedStack.workDir, "csf-profile-claim-secret"),
  "utf8",
).trim();
if (!/^[a-f0-9]{64}$/u.test(profileClaimSecret)) {
  throw new Error("The isolated CSF profile-claim secret is missing or invalid.");
}
const ambientProfileClaimSecret = process.env.CSF_PROFILE_CLAIM_SECRET?.trim();
if (
  ambientProfileClaimSecret
  && ambientProfileClaimSecret !== profileClaimSecret
) {
  throw new Error(
    "CSF_PROFILE_CLAIM_SECRET does not belong to the selected isolated stack.",
  );
}
// The isolated app runner owns exactly one port, and the browser suite talks to
// exactly that port. There is no overridable port or base URL left in this file
// and no ambient-server fallback: an overridable target meant the browser run
// could be pointed at a server whose environment nobody validated, which is the
// same adoption defect the cron harness already refuses.
const port = CSF_ISOLATED_APP_PORT;
const baseURL = `http://127.0.0.1:${port}`;
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
  // One web server, started only through the isolated app runner. The runner
  // builds its own child environment from the validated marker, so nothing is
  // spread from this process into it: the two values below are the runner's own
  // strict inputs, not app configuration.
  //
  // `reuseExistingServer: false` matches the runner's exclusive claim model —
  // the runner refuses an occupied 3000 rather than adopting it, so a reused
  // server would be a server it never validated.
  webServer: {
    // Invoke the signal-owning bootstrap directly. A package-runner wrapper can
    // absorb Playwright's teardown signal and orphan the owned Next group.
    command: "node scripts/local-dev/bootstrap-dvhs-csf-dev.mjs",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 15_000,
    },
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      CSF_ISOLATED_WORK_DIR: isolatedStack.workDir,
    },
  },
});
