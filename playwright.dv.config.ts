import path from "node:path";

import { defineConfig, devices } from "@playwright/test";
import {
  CSF_ISOLATED_APP_PORT,
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
} from "./scripts/local-dev/dv-local-env.mjs";

// Live status/credential validation bound to the selected isolated stack. The
// browser child gets its Supabase values from the isolated app runner's own
// validated app environment rather than from here, so nothing is bound.
getCsfIsolatedSupabaseEnv();
const isolatedStack = inspectCsfIsolatedWorkDir(
  process.env.CSF_ISOLATED_WORK_DIR,
);

// The isolated app runner owns exactly one port. This suite used to start its
// own ambient Next server on a port of its own, in the operator's full
// environment, which meant the DV browser run reached whatever providers that
// shell happened to be configured for.
const port = CSF_ISOLATED_APP_PORT;
// Match the canonical origin written into the generated Supabase/Auth config.
// Mixing 127.0.0.1 browser cookies with a localhost canonical origin made the
// first SSR request after sign-in intermittently fall back to /login.
const baseURL = `http://localhost:${port}`;
const artifactRoot = path.join(
  process.cwd(),
  "artifacts",
  "dvhs-csf-e2e",
  process.env.CSF_E2E_RUN_ID ?? "playwright-local",
  "playwright",
);

export default defineConfig({
  testDir: "./tests/dv",
  outputDir: path.join(artifactRoot, "dv-test-results"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // CI cold-compiles three unrelated route trees through the isolated Next
  // server. Keep each test bounded while allowing the full suite and teardown
  // to finish after those one-time compiles.
  timeout: 90_000,
  globalTimeout: process.env.CI ? 600_000 : undefined,
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { outputFolder: path.join(artifactRoot, "dv-html"), open: "never" }],
      ]
    : "list",
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // One web server, started only through the isolated app runner, which builds
  // its own provider-disabled child environment from the validated marker.
  // Nothing is spread from this process into it.
  //
  // `reuseExistingServer: false` unconditionally — including locally — matches
  // the runner's exclusive claim model: it refuses an occupied 3000 rather than
  // adopting it, so a reused server would be one it never validated.
  webServer: {
    // Invoke the signal-owning bootstrap directly. A package-runner wrapper can
    // absorb Playwright's teardown signal and orphan the owned Next group.
    command: "node scripts/local-dev/bootstrap-dvhs-csf-dev.mjs",
    // Readiness must compile the first interactive route, not only the static
    // root shell. Otherwise Next's initial webpack HMR refresh can replace the
    // layout chunks while LoginClient is hydrating in the first test.
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
