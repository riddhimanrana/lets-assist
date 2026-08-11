import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  repositoryRoot,
  launcherPath,
  generatedDirectories,
  resolveNodeExecutable,
  createSandbox,
  launcherEnvironment,
  launch,
  readCalls,
} from "./csf-browser-harness.fixture";
import {
  createFakeRepository,
  runVerifier,
} from "./csf-browser-harness-verifier.fixture";

describe("redesign verifier cleanup matrix", () => {
  test("(main 0, cleanup 0) passes only after teardown is accounted for", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, {});

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      "Isolated stack origin: generated clean migration replay",
    );
    expect(result.output).toContain("Stopped isolated Supabase project");
    expect(result.output).toContain(
      "PASS: DVHS CSF local isolated replay gate completed on one generated isolated stack.",
    );
    const supabaseCalls = await readCalls(sandbox.supabaseCalls);
    expect(
      supabaseCalls.filter((call) => call.startsWith("start ")).length,
    ).toBe(1);
    expect(
      supabaseCalls.filter((call) => call.startsWith("test db")).length,
    ).toBe(1);
    expect(supabaseCalls.some((call) => call.includes("db reset"))).toBe(false);
  }, 60_000);

  test("(main N, cleanup 0) preserves the gate status", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, { FAKE_BUN_FAIL: "typecheck" });

    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("Stopped isolated Supabase project");
    expect(result.output).toContain(
      "FAIL: DVHS CSF local isolated replay gate did not complete.",
    );
    expect(result.output).not.toContain("isolated stack teardown failed");
  }, 60_000);

  test("(main 0, cleanup C) turns a clean gate into the cleanup failure status", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, { FAKE_SUPABASE_STOP_FAIL: "1" });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain(
      "FAIL: isolated stack teardown failed with status 1.",
    );
    expect(result.output).toContain(
      "FAIL: gate steps passed, but isolated stack cleanup failed.",
    );
    expect(result.output).not.toContain(
      "PASS: DVHS CSF local isolated replay gate",
    );
  }, 60_000);

  test("(main N, cleanup C) keeps the primary status while reporting cleanup", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, {
      FAKE_BUN_FAIL: "typecheck",
      FAKE_SUPABASE_STOP_FAIL: "1",
    });

    expect(result.exitCode).toBe(3);
    expect(result.output).toContain(
      "FAIL: isolated stack teardown failed with status 1.",
    );
    expect(result.output).toContain(
      "Preserving the original gate failure status 3.",
    );
  }, 60_000);

  test("a caller-owned prepared stack is verified but never started, stopped, or deleted", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);
    const preparedWorkDir = join(root, "tmp", "prepared");

    const prepared = Bun.spawnSync(
      [
        "/bin/bash",
        join(root, "scripts/local-dev/start-dvhs-csf-isolated-stack.sh"),
      ],
      {
        cwd: root,
        env: {
          ...launcherEnvironment(sandbox, {
            CSF_ISOLATED_RUN_ID: "prepared-one",
            CSF_ISOLATED_WORK_DIR: preparedWorkDir,
          }),
          PATH: `${sandbox.fakeBin}:${dirname(resolveNodeExecutable())}:/usr/bin:/bin`,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(prepared.exitCode).toBe(0);

    await writeFile(sandbox.supabaseCalls, "");
    const result = runVerifier(sandbox, root, {
      CSF_ISOLATED_WORK_DIR: preparedWorkDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      "Isolated stack origin: caller-owned prepared stack",
    );
    expect(result.output).toContain("Prepared-Stack App Environment");
    expect(result.output).toContain(
      "PASS: DVHS CSF local isolated replay gate completed on one caller-owned prepared stack.",
    );
    expect(result.output).not.toContain("clean migration replay");

    const calls = await readCalls(sandbox.supabaseCalls);
    expect(calls.some((call) => call.startsWith("start "))).toBe(false);
    expect(calls.some((call) => call.startsWith("stop "))).toBe(false);
    expect(calls.some((call) => call.includes("db reset"))).toBe(false);
    expect(
      existsSync(join(preparedWorkDir, ".lets-assist-csf-isolated-stack")),
    ).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Source contracts: CI job slice, verifier, and workflow gate.
// ---------------------------------------------------------------------------

// Parse only the db-replay-validation job: no assertion here may be satisfied by
// an unrelated job elsewhere in the workflow.
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

describe("db-replay-validation CI job contract", () => {
  test("starts exactly one launcher and never resets or nests a replay", () => {
    const job = dbReplayJob();

    expect(
      job.match(/scripts\/local-dev\/start-dvhs-csf-isolated-stack\.sh/gu)
        ?.length,
    ).toBe(1);
    expect(job).not.toContain("supabase db reset");
    expect(job).not.toContain("csf:test:db:isolated");
    expect(job.match(/supabase test db --workdir/gu)?.length).toBe(1);
    expect(job.match(/bun run csf:seed:platform:isolated/gu)?.length).toBe(1);
    expect(job).not.toContain("bun run supabase:seed:local-dev");
    expect(job.match(/bun run dv:fixtures/gu)?.length).toBe(1);
  });

  test("loads the app environment through the exact-byte loader, never by sourcing it", () => {
    const job = dbReplayJob();

    expect(job).toContain(
      "node scripts/local-dev/dv-local-env.mjs --print-app-env",
    );
    expect(job).not.toContain(
      'source "${CSF_ISOLATED_WORK_DIR}/lets-assist-browser.sh"',
    );
    expect(job).not.toMatch(/source .*lets-assist-browser\.sh/u);
    expect(job).toContain(
      "node scripts/local-dev/dv-local-env.mjs --csf-health",
    );
    expect(job).not.toContain("dv-local-env.mjs --health");
  });

  test("generates one bounded run ID and requires an absent work directory", () => {
    const job = dbReplayJob();

    expect(job).toContain("- name: Allocate one bounded isolated run identity");
    expect(job).toContain(
      'if [[ ! "${run_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$ ]]; then',
    );
    expect(job).toContain(
      'if [[ -e "${work_dir}" || -L "${work_dir}" ]]; then',
    );
    expect(job).not.toContain(
      "CSF_ISOLATED_RUN_ID: ci-${{ github.run_id }}-${{ github.run_attempt }}",
    );
  });

  test("step labels are truthful and one marker-bounded stop always runs", () => {
    const job = dbReplayJob();

    expect(job).toContain("- name: Validate CSF database workflows");
    expect(job).not.toContain(
      "Validate CSF workflows and public privacy boundary",
    );
    expect(job).not.toContain("- name: Validate DB reset replay");
    expect(job).toContain("- name: Seed fictional platform and DV fixtures");
    expect(job).toContain("- name: Stop isolated Let’s Assist Supabase");
    expect(job).toContain("if: always()");
    expect(job.match(/stop-dvhs-csf-isolated-stack\.sh/gu)?.length).toBe(1);
  });

  test("sensitive credential exports are masked before they reach GITHUB_ENV", () => {
    const job = dbReplayJob();
    const startStep = job.slice(
      job.indexOf("- name: Start one isolated Let’s Assist Supabase"),
      job.indexOf(
        "- name: Validate database tests on the same running isolated stack",
      ),
    );
    const firstMask = startStep.indexOf("printf '::add-mask::%s");
    const maskCaseStart = startStep.indexOf('case "${key}" in');
    const maskCaseEnd = startStep.indexOf("esac", maskCaseStart);
    const environmentExport = startStep.indexOf(
      'printf \'%s=%s\\n\' "${key}" "${!key}" >> "${GITHUB_ENV}"',
    );
    const maskCase = startStep.slice(maskCaseStart, maskCaseEnd);

    expect(firstMask).toBeGreaterThan(-1);
    expect(maskCaseStart).toBeGreaterThan(firstMask);
    expect(environmentExport).toBeGreaterThan(maskCaseEnd);
    for (const sensitiveKey of [
      "ANON_KEY",
      "SERVICE_ROLE_KEY",
      "DB_URL",
      "SUPABASE_DB_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "CSF_PROFILE_CLAIM_SECRET",
    ]) {
      expect(maskCase).toContain(sensitiveKey);
    }
  });

  test("retains bounded, run-specific Playwright evidence after browser failures", () => {
    const ciWorkflow = readFileSync(
      join(repositoryRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    const playwrightConfig = readFileSync(
      join(repositoryRoot, "playwright.csf.config.ts"),
      "utf8",
    );
    const uploadStep = ciWorkflow.indexOf(
      "uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    const traceValidationStep = ciWorkflow.indexOf(
      "- name: Validate retained CSF browser traces",
    );
    const teardownStep = ciWorkflow.indexOf(
      "- name: Stop isolated Let’s Assist Supabase",
    );

    expect(ciWorkflow).toContain(
      "CSF_E2E_RUN_ID: ci-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(playwrightConfig).toContain(
      'process.env.CSF_E2E_RUN_ID ?? "playwright-local"',
    );
    expect(ciWorkflow).toContain("if-no-files-found: warn");
    expect(ciWorkflow).toContain("retention-days: 7");
    expect(traceValidationStep).toBeLessThan(uploadStep);
    expect(teardownStep).toBeGreaterThan(uploadStep);
  });
});

// ---------------------------------------------------------------------------
// Workflow probe behaviour, executed against the real script bytes with a
// dynamic fake Supabase client and a fetch counter. No database, no network.
// ---------------------------------------------------------------------------

const FAKE_SUPABASE_CLIENT = `
const scenario = JSON.parse(await Bun.file(process.env.CSF_FAKE_SCENARIO).text());
const journal = [];
// The journal is written out after every operation so the harness can assert the
// exact IDs handed to each cleanup, rather than trusting an internal counter.
function recordJournal() {
  require("node:fs").writeFileSync(process.env.CSF_FAKE_JOURNAL, JSON.stringify(journal));
}
recordJournal();

const FIXTURES = {
  organizations: [{ id: "org-1", username: "dvhs-csf" }],
  csf_profiles: [
    { id: "p1", first_name: "A", last_name: "One", school_email: "a@school.test", personal_email: null },
    { id: "p2", first_name: "B", last_name: "Two", school_email: "b@school.test", personal_email: null },
    { id: "p3", first_name: "C", last_name: "Three", school_email: "c@school.test", personal_email: null },
  ],
  csf_term_memberships: [
    { id: "m1", profile_id: "p1", term_id: "t1", status: "active", application_id: null },
    { id: "m2", profile_id: "p2", term_id: "t1", status: "active", application_id: null },
  ],
  csf_terms: [{ id: "t1", code: "S26", is_current: true, closed_at: null }],
  csf_point_submissions: [{ id: "s1", profile_id: "p1", term_id: "t1", status: "approved" }],
  csf_submission_files: [
    { id: "f1", submission_id: "s1", bucket: "csf-private", object_path: "csf/org-1/f1.pdf" },
  ],
  csf_credit_records: [
    { id: "c1", submission_id: "s1", profile_id: "p1", term_id: "t1", points: 1, status: "awarded" },
  ],
  csf_admin_audit_events: [{ id: "a1", action: "approve", target_type: "submission" }],
};

function outcome(key, fallback) {
  const configured = scenario[key];
  if (!configured) return fallback;
  if (configured.throw) {
    const error = new Error(configured.throw);
    error.isFakeThrow = true;
    throw error;
  }
  return configured;
}

function builder(table, role) {
  const state = { table, role, op: "select" };
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    limit() { return chain; },
    in(_column, ids) { state.ids = ids; return chain; },
    insert(row) { state.op = "insert"; state.row = row; return chain; },
    delete() { state.op = "delete"; return chain; },
    maybeSingle() { return chain.then(); },
    single() { return chain.then(); },
    then(resolve, reject) {
      let result;
      try {
        result = resolveOperation(state);
      } catch (error) {
        return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
      }
      const promise = Promise.resolve(result);
      return resolve ? promise.then(resolve, reject) : promise;
    },
  };
  return chain;
}

function resolveOperation(state) {
  journal.push({ table: state.table, op: state.op, ids: state.ids ?? null, role: state.role });
  recordJournal();
  if (state.op === "select") {
    if (state.role === "anon") return { data: [], error: null };
    const rows = FIXTURES[state.table] ?? [];
    return { data: state.table === "organizations" ? rows[0] : rows, error: null };
  }
  if (state.op === "insert") {
    const key = state.table === "csf_submission_files"
      ? (journal.filter((entry) => entry.table === state.table && entry.op === "insert").length === 1
        ? "proofInsert"
        : "duplicateProofInsert")
      : "duplicateCreditInsert";
    return outcome(key, key === "proofInsert"
      ? { data: { id: "probe-proof-1" }, error: null }
      : { data: null, error: { code: "23505", message: "duplicate key" } });
  }
  if (state.op === "delete") {
    const key = state.table === "csf_submission_files" ? "proofCleanup" : "creditCleanup";
    return outcome(key, { data: (state.ids ?? []).map((id) => ({ id })), error: null });
  }
  throw new Error(\`unhandled fake operation: \${state.op}\`);
}

export function createClient(_url, key, _options) {
  const role = key === "fake-anon-token" ? "anon" : "service";
  return { from: (table) => builder(table, role) };
}
`;

const FAKE_ENV_MODULE = `
export function getCsfIsolatedSupabaseEnv() {
  return {
    url: "http://127.0.0.1:56351",
    anonKey: "fake-anon-token",
    serviceRoleKey: "fake-service-role-token",
    dbUrl: "postgresql://postgres:fake@127.0.0.1:56352/postgres",
  };
}
`;

const FETCH_COUNTER = `
const counterPath = process.env.CSF_FETCH_COUNTER;
let count = 0;
const original = globalThis.fetch;
globalThis.fetch = async (...args) => {
  count += 1;
  await Bun.write(counterPath, String(count));
  return original(...args);
};
await Bun.write(counterPath, "0");
`;

async function runWorkflowProbe(
  scenario: Record<string, unknown>,
  environment: Record<string, string> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "csf-workflow-probe-"));
  generatedDirectories.push(directory);
  const moduleDirectory = join(directory, "node_modules/@supabase/supabase-js");
  await mkdir(moduleDirectory, { recursive: true });
  await writeFile(
    join(moduleDirectory, "package.json"),
    JSON.stringify({
      name: "@supabase/supabase-js",
      version: "0.0.0-fake",
      type: "module",
      main: "index.mjs",
    }),
  );
  await writeFile(join(moduleDirectory, "index.mjs"), FAKE_SUPABASE_CLIENT);
  await writeFile(join(directory, "dv-local-env.mjs"), FAKE_ENV_MODULE);
  await writeFile(join(directory, "fetch-counter.mjs"), FETCH_COUNTER);
  await writeFile(join(directory, "scenario.json"), JSON.stringify(scenario));
  // The real script bytes, unmodified.
  await cp(
    join(repositoryRoot, "scripts/local-dev/test-dvhs-csf-workflows.mjs"),
    join(directory, "test-dvhs-csf-workflows.mjs"),
  );

  const counterPath = join(directory, "fetch-count");
  const journalPath = join(directory, "journal.json");
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--preload",
      join(directory, "fetch-counter.mjs"),
      join(directory, "test-dvhs-csf-workflows.mjs"),
    ],
    {
      cwd: directory,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? directory,
        CSF_FAKE_SCENARIO: join(directory, "scenario.json"),
        CSF_FAKE_JOURNAL: journalPath,
        CSF_FETCH_COUNTER: counterPath,
        ...environment,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const journal: Array<{
    table: string;
    op: string;
    ids: string[] | null;
    role: string;
  }> = existsSync(journalPath)
    ? JSON.parse(await readFile(journalPath, "utf8"))
    : [];

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    journal,
    // The exact ID arrays each cleanup was asked to delete, in order.
    cleanupIds: (table: string) =>
      journal
        .filter((entry) => entry.op === "delete" && entry.table === table)
        .map((entry) => entry.ids ?? []),
    fetchCount: existsSync(counterPath)
      ? Number((await readFile(counterPath, "utf8")).trim())
      : 0,
  };
}

describe("CSF workflow probe cleanup and route evidence", () => {
  test("cleans up exactly the returned probe IDs and requests no route without CSF_APP_URL", async () => {
    const result = await runWorkflowProbe({});

    expect(result.exitCode).toBe(0);
    expect(result.fetchCount).toBe(0);
    expect(result.stderr).toContain("CSF_APP_URL was not supplied");
    const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    expect(report.verified).toBe("database-workflows-only");
    expect(report.publicRouteVerified).toBe(false);

    // Exactly one proof cleanup, carrying exactly the ID the insert returned.
    expect(result.cleanupIds("csf_submission_files")).toEqual([
      ["probe-proof-1"],
    ]);
    // The refused duplicate credit returned no ID, so no credit delete is issued.
    expect(result.cleanupIds("csf_credit_records")).toEqual([]);
  });

  test("deletes an unexpectedly successful duplicate proof row too", async () => {
    const result = await runWorkflowProbe({
      duplicateProofInsert: { data: { id: "probe-proof-2" }, error: null },
    });

    // The contract assertion fails, but both attributable rows are still removed
    // — including the ID the unexpectedly successful duplicate returned.
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "Database did not enforce one proof per CSF submission",
    );
    expect(result.cleanupIds("csf_submission_files")).toEqual([
      ["probe-proof-1", "probe-proof-2"],
    ]);
    // The proof assertion aborts before the credit probe, so nothing was
    // inserted there and no credit delete is issued.
    expect(result.cleanupIds("csf_credit_records")).toEqual([]);
    expect(result.stderr).not.toContain("left probe-proof");
  });

  test("deletes an unexpectedly successful duplicate credit row too", async () => {
    const result = await runWorkflowProbe({
      duplicateCreditInsert: { data: { id: "probe-credit-9" }, error: null },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "Database did not enforce one awarded credit per CSF submission",
    );
    expect(result.cleanupIds("csf_submission_files")).toEqual([
      ["probe-proof-1"],
    ]);
    expect(result.cleanupIds("csf_credit_records")).toEqual([
      ["probe-credit-9"],
    ]);
  });

  test("a thrown first cleanup still runs the second cleanup and surfaces both", async () => {
    const result = await runWorkflowProbe({
      proofCleanup: { throw: "connection reset during proof cleanup" },
      duplicateCreditInsert: { data: { id: "probe-credit-1" }, error: null },
      creditCleanup: { throw: "connection reset during credit cleanup" },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("csf_submission_files probe cleanup threw");
    expect(result.stderr).toContain("csf_credit_records probe cleanup threw");
    // Both cleanups were genuinely attempted with their exact IDs, even though
    // the first one threw.
    expect(result.cleanupIds("csf_submission_files")).toEqual([
      ["probe-proof-1"],
    ]);
    expect(result.cleanupIds("csf_credit_records")).toEqual([
      ["probe-credit-1"],
    ]);
  });

  test("a cleanup that removes nothing fails the run with the stranded IDs", async () => {
    const result = await runWorkflowProbe({
      proofCleanup: { data: [], error: null },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "csf_submission_files probe cleanup left probe-proof-1 in place.",
    );
  });

  test("a primary failure is preserved while every cleanup failure is reported", async () => {
    const result = await runWorkflowProbe({
      duplicateProofInsert: {
        data: null,
        error: { code: "00000", message: "no constraint" },
      },
      proofCleanup: { data: null, error: { message: "delete refused" } },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "CSF probe cleanup failure: csf_submission_files probe cleanup failed: delete refused",
    );
    expect(result.stderr).toContain(
      "Database did not enforce one proof per CSF submission",
    );
  });

  test("an explicit CSF_APP_URL makes route unavailability its own distinct failure", async () => {
    const result = await runWorkflowProbe(
      {},
      {
        // Reserved discard port: the request is attempted and fails to connect.
        CSF_APP_URL: "http://127.0.0.1:9",
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.fetchCount).toBeGreaterThan(0);
    expect(result.stderr).toContain(
      "was unreachable at the explicit CSF_APP_URL",
    );
    expect(result.stderr).not.toContain("verified database workflows only");
  });
});

describe("shared profile-claim secret contract", () => {
  test("one random per-stack signing secret is shared across launch paths", () => {
    const playwrightConfig = readFileSync(
      join(repositoryRoot, "playwright.csf.config.ts"),
      "utf8",
    );
    const stackLauncher = readFileSync(launcherPath, "utf8");
    const ciWorkflow = readFileSync(
      join(repositoryRoot, ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(playwrightConfig).toContain("CSF_PROFILE_CLAIM_SECRET");
    expect(playwrightConfig).toContain("csf-profile-claim-secret");
    expect(playwrightConfig).toContain("readFileSync");
    expect(playwrightConfig).toContain(
      "ambientProfileClaimSecret !== profileClaimSecret",
    );
    expect(stackLauncher).toContain("CSF_PROFILE_CLAIM_SECRET");
    expect(stackLauncher).toContain("csf-profile-claim-secret");
    expect(stackLauncher).toContain("randomBytes(32)");
    expect(playwrightConfig).not.toContain("createHash");
    expect(stackLauncher).not.toContain("createHash");
    expect(stackLauncher).not.toContain("process.env.SERVICE_ROLE_KEY");
    expect(stackLauncher).toContain(
      "emit_app_env_value CSF_PROFILE_CLAIM_SECRET",
    );
    expect(ciWorkflow).toContain("CSF_PROFILE_CLAIM_SECRET");
    expect(ciWorkflow).toContain("id: start-isolated");
    expect(ciWorkflow).toContain(
      "if: ${{ always() && steps.start-isolated.outcome == 'success' }}",
    );
    const orchestrator = readFileSync(
      join(repositoryRoot, "scripts/run-tests.mjs"),
      "utf8",
    );
    for (const testFile of [
      "lib/auth/theme-script-boundary.test.ts",
      "scripts/local-dev/csf-browser-harness.launcher-ownership.test.ts",
      "scripts/local-dev/csf-browser-harness.docker-lifecycle.test.ts",
      "scripts/local-dev/csf-browser-harness.verifier-workflow.test.ts",
      "scripts/local-dev/csf-browser-harness.ci-contracts.test.ts",
      "services/google-drive-metadata.test.ts",
      "services/google-sheets-report-safety.test.ts",
      "services/google-sheets-source-snapshot.test.ts",
    ]) {
      expect(orchestrator).toContain(testFile);
    }
  });
});

// ---------------------------------------------------------------------------
// Recovery topology, remote-readiness separation, and runbook contracts.
// ---------------------------------------------------------------------------

describe("recovery base port", () => {
  test("prefers the 55320 recovery bundle when it is available", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("base-default");

    // Empty rather than absent: the launcher's `:-` default must still apply.
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "base-default",
      CSF_ISOLATED_WORK_DIR: workDir,
      CSF_ISOLATED_BASE_PORT: "",
    });

    expect(result.exitCode).toBe(0);
    const marker = await readFile(
      join(workDir, ".lets-assist-csf-isolated-stack"),
      "utf8",
    );
    expect(marker).toContain("base_port=55320");

    const config = await readFile(
      join(workDir, "supabase", "config.toml"),
      "utf8",
    );
    // The exact recovery bundle: API 55321, DB 55322, Studio 55323, Mailpit UI
    // 55324, SMTP 55325, edge inspector 55326, analytics 55327, pooler 55329.
    for (const port of [
      55320, 55321, 55322, 55323, 55324, 55325, 55326, 55327, 55329,
    ]) {
      expect(config).toContain(String(port));
    }
    expect(config).not.toContain("55328");
    expect(result.stdout).toContain("API: http://127.0.0.1:55321");
  }, 60_000);

  test("an explicit caller override still wins", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("base-override");

    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "base-override",
      CSF_ISOLATED_WORK_DIR: workDir,
      CSF_ISOLATED_BASE_PORT: "61000",
    });

    expect(result.exitCode).toBe(0);
    expect(
      await readFile(join(workDir, ".lets-assist-csf-isolated-stack"), "utf8"),
    ).toContain("base_port=61000");
  }, 60_000);

  test("an implicit default advances past a host-port collision", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("base-collision");

    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "base-collision",
      CSF_ISOLATED_WORK_DIR: workDir,
      CSF_ISOLATED_BASE_PORT: "",
      FAKE_LSOF_OCCUPIED_PORTS: "55322",
    });

    expect(result.exitCode).toBe(0);
    expect(
      await readFile(join(workDir, ".lets-assist-csf-isolated-stack"), "utf8"),
    ).toContain("base_port=55330");
    expect(
      await readFile(join(workDir, "supabase", "config.toml"), "utf8"),
    ).toContain("port = 55332");
  }, 60_000);

  test("the launcher source prefers 55320 and refuses an out-of-range base", () => {
    const launcherSource = readFileSync(launcherPath, "utf8");
    expect(launcherSource).toContain(
      'BASE_PORT="${CSF_ISOLATED_BASE_PORT:-55320}"',
    );
    expect(launcherSource).not.toContain("56350");
    expect(launcherSource).toContain("BASE_PORT=$((BASE_PORT + 10))");
    // Explicit allocator collision refusal is preserved.
    expect(launcherSource).toContain("PORT_OFFSETS=(0 1 2 3 4 5 6 7 9)");
    expect(launcherSource).toContain(
      'fail "CSF_ISOLATED_BASE_PORT must be an integer between 1024 and 65526."',
    );
  });

  test("no launcher, teardown, or runbook path names the protected 56450 runtime", () => {
    for (const file of [
      "scripts/local-dev/start-dvhs-csf-isolated-stack.sh",
      "scripts/local-dev/stop-dvhs-csf-isolated-stack.sh",
      "scripts/local-dev/verify-supabase-redesign.sh",
      "scripts/local-dev/README.md",
      "scripts/local-dev/README-fixtures.md",
      ".github/workflows/ci.yml",
    ]) {
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      expect(
        source,
        `${file} must not name the protected legacy stack`,
      ).not.toContain("56450");
      for (const port of [
        "56451",
        "56452",
        "56453",
        "56454",
        "56455",
        "56456",
        "56457",
      ]) {
        expect(source, `${file} must not name ${port}`).not.toContain(port);
      }
    }
  });
});
