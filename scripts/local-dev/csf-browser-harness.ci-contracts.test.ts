import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  repositoryRoot,
  createSandbox,
  readCalls,
} from "./csf-browser-harness.fixture";
import {
  createFakeRepository,
  runVerifier,
} from "./csf-browser-harness-verifier.fixture";

function dbReplayJob() {
  const workflow = readFileSync(
    join(repositoryRoot, ".github/workflows/ci.yml"),
    "utf8",
  );
  const marker = "\n  db-replay-validation:\n";
  const start = workflow.indexOf(marker);
  if (start === -1)
    throw new Error("db-replay-validation job is missing from ci.yml");
  const body = workflow.slice(start + marker.length);
  const nextJob = /^ {2}[A-Za-z][A-Za-z0-9_-]*:\s*$/mu.exec(body);
  return nextJob ? body.slice(0, nextJob.index) : body;
}
describe("local replay gate is separated from blocked remote readiness", () => {
  test("by default the audit does not run and the gate says so explicitly", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, {});

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      "Remote readiness: NOT EVALUATED — separate blocked release gate.",
    );
    const bunCalls = await readCalls(join(sandbox.directory, "bun-calls.log"));
    expect(bunCalls).not.toContain("run db:audit:remote-readiness");
    // Never a global readiness PASS from the local path.
    expect(result.output).not.toContain("PASS: Supabase redesign");
    expect(result.output).toContain(
      "PASS: DVHS CSF local isolated replay gate completed on one generated isolated stack.",
    );
    expect(result.output).toContain(
      "Scope: local isolated replay only. Not a Supabase, Production, or preview readiness result.",
    );
  }, 60_000);

  test("exactly 1 opts in and runs the unchanged audit", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, {
      CSF_REQUIRE_REMOTE_READINESS: "1",
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain("Remote readiness: NOT EVALUATED");
    expect(result.output).toContain(
      "Supabase Remote Server-Only Readiness Audit (explicitly required)",
    );
    const bunCalls = await readCalls(join(sandbox.directory, "bun-calls.log"));
    expect(bunCalls).toContain("run db:audit:remote-readiness");
  }, 60_000);

  test("an opted-in audit failure propagates instead of being swallowed", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, {
      CSF_REQUIRE_REMOTE_READINESS: "1",
      FAKE_BUN_FAIL: "db:audit:remote-readiness",
    });

    expect(result.exitCode).toBe(3);
    expect(result.output).toContain(
      "FAIL: DVHS CSF local isolated replay gate did not complete.",
    );
    expect(result.output).not.toContain(
      "PASS: DVHS CSF local isolated replay gate",
    );
  }, 60_000);

  test("any other nonempty value fails before starting anything", async () => {
    for (const value of ["true", "yes", "0", "on", "TRUE", "1 ", "01"]) {
      const sandbox = await createSandbox("csf-verifier-");
      const root = await createFakeRepository(sandbox);

      const result = runVerifier(sandbox, root, {
        CSF_REQUIRE_REMOTE_READINESS: value,
      });

      expect(result.exitCode, `value=${JSON.stringify(value)}`).not.toBe(0);
      expect(result.output).toContain(
        "CSF_REQUIRE_REMOTE_READINESS must be unset, empty, or exactly 1",
      );
      // Nothing started: no launcher, no stack, no teardown.
      const supabaseCalls = await readCalls(sandbox.supabaseCalls);
      expect(supabaseCalls.filter((call) => call.startsWith("start "))).toEqual(
        [],
      );
      expect(supabaseCalls.filter((call) => call.startsWith("stop "))).toEqual(
        [],
      );
    }
  }, 120_000);

  test("the audit script itself is untouched by this wave", () => {
    const auditSource = readFileSync(
      join(repositoryRoot, "scripts/audit-supabase-remote-readiness.sh"),
      "utf8",
    );
    const digest = new Bun.CryptoHasher("sha256")
      .update(auditSource)
      .digest("hex");
    expect(digest).toBe(
      "058ef50ce10b130482fc3b9d57216102a04bdd728e1146523fd713533db86bad",
    );
  });

  test("the gate names its omissions rather than implying full coverage", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, {});

    expect(result.output).toContain("This gate does NOT cover:");
    for (const omission of [
      "next build",
      "the full private-plugin corpus",
      "scale (bun run csf:test:scale)",
      "the full CSF E2E suite, the action matrix, or screenshots",
      "public route proof, unless CSF_APP_URL was supplied",
      "Production, the preview project, or any provider",
    ]) {
      expect(result.output).toContain(omission);
    }
  }, 60_000);

  test("the verifier seeds only through the isolated mode script", () => {
    const verifierSource = readFileSync(
      join(repositoryRoot, "scripts/local-dev/verify-supabase-redesign.sh"),
      "utf8",
    );
    expect(verifierSource).toContain("bun run csf:seed:platform:isolated");
    expect(verifierSource).not.toContain("bun run supabase:seed:local-dev");
    // Prohibited recovery paths must never reappear here.
    expect(verifierSource).not.toContain("bun run supabase\n");
    expect(verifierSource).not.toContain("csf:test:db:isolated");
    expect(verifierSource).not.toContain("supabase db reset");
    expect(verifierSource).not.toContain("--linked");
    // The cron harness owns its server; no base URL may be supplied.
    expect(verifierSource).not.toContain("CRON_TEST_BASE_URL");
  });
});

describe("CI db-replay-validation uses the recovery topology and isolated seed", () => {
  test("pins the recovery base port and the isolated seed script", () => {
    const job = dbReplayJob();

    expect(job).toMatch(/CSF_ISOLATED_BASE_PORT:\s*["']55320["']/u);
    expect(job).not.toContain("56350");
    expect(job).toContain("bun run csf:seed:platform:isolated");
    expect(job).not.toContain("bun run supabase:seed:local-dev");
  });
});

// ---------------------------------------------------------------------------
// Restored CI coverage.
//
// Four test files existed and CI ran none of them. They cannot simply be
// appended to an existing `bun test` line either: each installs global module
// mocks, and Bun's module registry is per-process, so a combined invocation lets
// one file's mocks decide another file's result.
// ---------------------------------------------------------------------------
function ciWorkflowSource() {
  return readFileSync(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
}

function ciJob(name: string) {
  const workflow = ciWorkflowSource();
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error(`${name} job is missing from ci.yml`);
  const body = workflow.slice(start + marker.length);
  const nextJob = /^ {2}[A-Za-z][A-Za-z0-9_-]*:\s*$/mu.exec(body);
  return nextJob ? body.slice(0, nextJob.index) : body;
}

describe("CI runs mock-sensitive tests through the shared process orchestrator", () => {
  const separatelyRunTests = [
    "scripts/local-dev/seed-platform.test.ts",
    "scripts/local-dev/cron-auth-shape-probe.test.ts",
    "scripts/local-dev/test-cron-endpoints.test.ts",
    "scripts/local-dev/run-dvhs-csf-isolated-app.test.ts",
  ];

  test("the quality job invokes the same test interface developers use", () => {
    const job = ciJob("quality");
    expect(job).toContain("run: bun run format:check");
    expect(job).toContain("run: bun run test");
    expect(job).not.toContain("bun test \\");
  });

  test("the orchestrator names each sensitive suite once and spawns every group", () => {
    const orchestrator = readFileSync(
      join(repositoryRoot, "scripts/run-tests.mjs"),
      "utf8",
    );
    for (const file of separatelyRunTests) {
      expect(orchestrator.split(file).length - 1, file).toBe(1);
    }
    expect(orchestrator).toContain("spawnSync(command, args");
    expect(orchestrator).toContain("for (const group of groups)");
  });

  test("the cron probe suite keeps its server-only preload", () => {
    const orchestrator = readFileSync(
      join(repositoryRoot, "scripts/run-tests.mjs"),
      "utf8",
    );
    expect(orchestrator).toContain("--preload");
    expect(orchestrator).toContain(
      "./scripts/local-dev/server-only-test-preload.ts",
    );
    expect(orchestrator).toContain(
      "scripts/local-dev/cron-auth-shape-probe.test.ts",
    );
  });

  test("the workflow states why the split exists", () => {
    const workflow = ciWorkflowSource();
    expect(workflow).toContain("module mocks");
    expect(workflow).toContain("Bun's module registry is per-process");
  });
});

describe("CI replays the seven-route cron smoke in the right order", () => {
  test("dev:test:cron runs after seeding and before Playwright", () => {
    const job = dbReplayJob();
    const seed = job.indexOf("- name: Seed fictional platform and DV fixtures");
    const cron = job.indexOf("run: bun run dev:test:cron");
    const playwrightInstall = job.indexOf(
      "- name: Install Playwright Chromium",
    );
    const csfBrowser = job.indexOf("run: bun run csf:test:e2e");

    expect(seed).toBeGreaterThan(-1);
    expect(cron).toBeGreaterThan(seed);
    expect(playwrightInstall).toBeGreaterThan(cron);
    expect(csfBrowser).toBeGreaterThan(playwrightInstall);
    expect(job.match(/bun run dev:test:cron/gu)?.length).toBe(1);
  });

  test("cron route and helper paths trigger the DB-related job", () => {
    const workflow = ciWorkflowSource();
    const filters = workflow.slice(
      workflow.indexOf("filters: |"),
      workflow.indexOf("  quality:"),
    );
    expect(filters).toContain("- 'app/api/cron/**'");
    expect(filters).toContain("- 'lib/cron/**'");
    // Broadened, not narrowed: the single-route filter it replaces is gone.
    expect(filters).not.toContain(
      "- 'app/api/cron/organization-sheet-sync/**'",
    );
  });

  test("CI still contacts neither Production nor preview", () => {
    const workflow = ciWorkflowSource();
    expect(workflow).not.toContain("fotdmeakexgrkronxlof");
    expect(workflow).not.toContain("qitbdwqobjpiixfwhhyo");
    expect(workflow).not.toContain("supabase link");
    expect(workflow).not.toContain("--linked");
    // The isolated launcher and the remote-readiness opt-in are unchanged.
    expect(workflow).toContain(
      "scripts/local-dev/start-dvhs-csf-isolated-stack.sh",
    );
    expect(workflow).not.toContain("CSF_REQUIRE_REMOTE_READINESS");
  });
});

describe("both browser suites start only the isolated app runner", () => {
  const configs = ["playwright.csf.config.ts", "playwright.dv.config.ts"];

  test("Playwright loads the isolated ESM validator without a CommonJS transform", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    ) as { type?: string };
    const csfConfig = readFileSync(
      join(repositoryRoot, "playwright.csf.config.ts"),
      "utf8",
    );
    const sitemapConfig = readFileSync(
      join(repositoryRoot, "next-sitemap.config.js"),
      "utf8",
    );

    expect(packageJson.type).toBe("module");
    expect(csfConfig).toContain('from "./scripts/local-dev/dv-local-env.mjs"');
    expect(csfConfig).toContain('import nextEnv from "@next/env"');
    expect(sitemapConfig).toContain('import fg from "fast-glob"');
    expect(sitemapConfig).toContain("export default {");
  });

  test("each web server is the runner on the owned fixed port", () => {
    for (const file of configs) {
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      expect(source, file).toContain(
        'command: "node scripts/local-dev/bootstrap-dvhs-csf-dev.mjs"',
      );
      expect(source, file).toContain("CSF_ISOLATED_APP_PORT");
      expect(source, file).toContain("reuseExistingServer: false");
      expect(source, file).toContain('signal: "SIGTERM"');
      expect(source, file).toContain("timeout: 15_000");
      expect(source, file).not.toContain("...process.env");
      expect(source, file).not.toContain("next dev");
      expect(source, file).not.toContain("3100");
      expect(source, file).not.toContain("3113");
    }
  });

  test("the CSF suite keeps its route and project selection", () => {
    const source = readFileSync(
      join(repositoryRoot, "playwright.csf.config.ts"),
      "utf8",
    );
    expect(source).toContain('testDir: "./tests/e2e/csf"');
    expect(source).toContain('testMatch: "**/*.spec.ts"');
    expect(source).toContain('name: "chromium"');
    expect(source).toContain(
      'process.env.CSF_E2E_RUN_ID ?? "playwright-local"',
    );
  });

  test("the DV suite keeps its route and project selection", () => {
    const source = readFileSync(
      join(repositoryRoot, "playwright.dv.config.ts"),
      "utf8",
    );
    const workflow = readFileSync(
      join(repositoryRoot, "tests/e2e/dv/vertical-workflow.spec.ts"),
      "utf8",
    );
    expect(source).toContain('testDir: "./tests/e2e/dv"');
    expect(source).toContain('name: "chromium"');
    expect(source).toContain("timeout: 90_000");
    expect(source).toContain(
      "globalTimeout: process.env.CI ? 600_000 : undefined",
    );
    expect(source).toContain(
      'outputDir: path.join(artifactRoot, "dv-test-results")',
    );
    expect(source).toContain("url: `${baseURL}/login`");
    expect(workflow).toContain("new URL(page.url()).pathname");
    expect(workflow).toContain(
      'page.reload({ waitUntil: "domcontentloaded" })',
    );
    expect(workflow).toContain(
      "await expect(limitedAvailability).toBeChecked()",
    );
  });
});

describe("runbooks lead with the isolated contract", () => {
  const readme = readFileSync(
    join(repositoryRoot, "scripts/local-dev/README.md"),
    "utf8",
  );
  const fixtures = readFileSync(
    join(repositoryRoot, "scripts/local-dev/README-fixtures.md"),
    "utf8",
  );

  test("the CSF recovery sections lead with the isolated launcher and the exact-byte loader", () => {
    for (const source of [readme, fixtures]) {
      expect(source).toContain(
        "scripts/local-dev/start-dvhs-csf-isolated-stack.sh",
      );
      expect(source).toContain(
        "node scripts/local-dev/dv-local-env.mjs --print-app-env",
      );
      expect(source).toContain("bun run csf:seed:platform:isolated");
    }
  });

  test("prohibited DVHS CSF recovery commands are named inside the prohibition block", () => {
    const heading = "### Prohibited for DVHS CSF recovery";
    const start = readme.indexOf(heading);
    expect(start).toBeGreaterThan(-1);
    // Scope to the block: `bun run supabase` is a substring of
    // `bun run supabase:seed:local-dev`, so a whole-file search would pass on
    // the shared-local instructions this wave must preserve.
    const block = readme.slice(
      start,
      readme.indexOf("### The recovery sequence", start),
    );
    expect(block).toContain("`bun run supabase`");
    expect(block).toContain("supabase db reset");
    expect(block).toContain("`bun run csf:test:db:isolated`");
    expect(block).toContain("--linked");
    expect(block).toContain("`bun run supabase:seed:local-dev`");
    expect(block).toContain(
      "those remain the only permitted live stack and app launchers",
    );
  });

  test("teardown documents dry run first and deletion only after Docker residual proof", () => {
    for (const source of [readme, fixtures]) {
      expect(source).toContain("--dry-run");
      expect(source).toContain("--delete-workdir");
      expect(source).toContain("residual proof");
    }
  });

  test("the non-CSF shared-local bootstrap instructions are preserved", () => {
    expect(readme).toContain("bun run supabase:seed:local-dev");
    expect(readme).toContain("bun run dv:fixtures");
  });

  test("no runbook tells a CSF operator to launch the app ambiently", () => {
    for (const source of [readme, fixtures]) {
      expect(source).toContain("bun run dev");
      expect(source).not.toContain("bunx next dev");
    }
    expect(readme).not.toContain("bun run dev -- --port 3000");
    const prohibition = readme.slice(
      readme.indexOf("### Prohibited for DVHS CSF recovery"),
      readme.indexOf("### The recovery sequence"),
    );
    expect(prohibition).toContain("`bun run dev:next`");
    const recoverySequence = readme.slice(
      readme.indexOf("### The recovery sequence"),
      readme.indexOf("## Useful follow-up checks"),
    );
    expect(recoverySequence).toContain("bun run dev");
    expect(recoverySequence).toContain(
      "node scripts/local-dev/run-dvhs-csf-isolated-app.mjs",
    );
    expect(fixtures).not.toContain("bun run dev -- --port 3000");

    // The launcher's own final instruction says the same thing.
    const launcher = readFileSync(
      join(
        repositoryRoot,
        "scripts/local-dev/start-dvhs-csf-isolated-stack.sh",
      ),
      "utf8",
    );
    expect(launcher).toContain('echo "App command: bun run dev');
    expect(launcher).not.toContain("bun run dev -- --port 3000");
  });

  test("the fixture reseed guidance is shared local, non-CSF only", () => {
    expect(fixtures).toContain("How to Re-Seed — shared local, non-CSF only");
    expect(fixtures).toContain("It seeds **no** DVHS CSF data");
    // The old claim that the shared bootstrap seeds DVHS CSF is gone.
    expect(fixtures).not.toContain(
      "seeds the\n> default platform and DVHS CSF fixtures",
    );
    expect(readme).toContain("shared local, non-CSF only");
    expect(readme).toContain(
      "creates,\nreplaces, and deletes no DVHS CSF organization, plugin, profile, membership,",
    );
  });

  test("the schema gate points at db:test:redesign, not the shared bootstrap", () => {
    const gate = readme.slice(
      readme.indexOf("## Supabase redesign gate"),
      readme.indexOf("### How `db:test:redesign` uses the isolated launcher"),
    );
    expect(gate).toContain("Run `bun run db:test:redesign`");
    expect(gate).not.toContain("then run `bun run supabase`");
    // Remote readiness is opt-in only, with the default stated.
    expect(gate).toContain("Remote readiness is **not** part of this gate");
    expect(gate).toContain("NOT EVALUATED — separate blocked release gate.");
    expect(gate).toContain("exactly `CSF_REQUIRE_REMOTE_READINESS=1`");
    expect(gate).not.toMatch(/^\d+\.\s+`bun run db:audit:remote-readiness`$/mu);
  });

  test("the seven-route cron claim is exact and names what it excludes", () => {
    expect(readme).toContain(
      "the seven selected worker routes:\n  auto-publish-hours, project-cancellations, organization-calendar-sync,\n  organization-sheet-sync, data-exports, csf-communications-dispatch, and\n  csf-scheduled-post-publisher",
    );
    for (const outside of [
      "`ai-moderation`",
      "`anonymous-cleanup`",
      "`csf-proof-cleanup`",
      "`generate-recurring-projects`",
      "`waiver-cleanup`",
    ]) {
      expect(readme, outside).toContain(outside);
    }
    expect(readme).not.toContain("prove every operational cron route");
  });

  test("no runbook still calls the shared stack a Vela stack", () => {
    for (const source of [readme, fixtures]) {
      expect(source).not.toContain("shared Vela");
      expect(source).not.toContain("Vela Supabase");
    }
    expect(readme).toContain("shared Let’s Assist local\nSupabase stack");
  });

  test("no runbook offers a shared reset, linked command, or bootstrap as CSF recovery", () => {
    const recovery = readme.slice(
      readme.indexOf("## DVHS CSF recovery — isolated only"),
    );
    // They appear only inside the prohibition table, never as instructions.
    const prohibition = recovery.slice(
      recovery.indexOf("### Prohibited for DVHS CSF recovery"),
      recovery.indexOf("### The recovery sequence"),
    );
    for (const forbidden of [
      "supabase db reset",
      "--linked",
      "`bun run supabase`",
    ]) {
      expect(prohibition, forbidden).toContain(forbidden);
    }
    const sequence = recovery.slice(
      recovery.indexOf("### The recovery sequence"),
      recovery.indexOf("## Useful follow-up checks"),
    );
    expect(sequence).not.toContain("supabase db reset");
    expect(sequence).not.toContain("--linked");
    expect(sequence).not.toContain("bun run supabase\n");
    expect(sequence).not.toContain("bun run supabase`");
  });
});
