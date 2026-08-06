import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const seedSource = [
  "./seed-platform.mjs",
  "./seed-platform-fixtures.mjs",
  "./seed-platform-csf-plan.mjs",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");
const actorHelperSource = readFileSync(
  new URL("../../tests/e2e/csf/helpers.ts", import.meta.url),
  "utf8",
);

function sourceSection(startMarker: string, endMarker: string) {
  const start = seedSource.indexOf(startMarker);
  const end = seedSource.indexOf(endMarker, start);
  expect(start, `Missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(
    0,
  );
  expect(end, `Missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return seedSource.slice(start, end);
}

function occurrenceCount(source: string, value: string) {
  return source.split(value).length - 1;
}

describe("local platform seed authorization", () => {
  test("V47: preserves the distinction between organization admin and platform super-admin", () => {
    expect(seedSource).toContain("superAdmin: true");
    expect(seedSource).toContain('role: "super_admin"');
    expect(seedSource).toContain("is_super_admin: true");
    expect(seedSource).toContain('roles: ["admin", "admin", "admin", "admin"]');
  });

  test("V43: repeat seeding preserves immutable CSF history", () => {
    const resetList = seedSource.slice(
      seedSource.indexOf("const csfTablesToReset"),
      seedSource.indexOf("for (const table of csfTablesToReset"),
    );
    expect(resetList).not.toContain('"csf_admin_audit_events"');
    expect(resetList).not.toContain('"csf_staff_position_history"');
    expect(resetList).not.toContain('"csf_terms"');
    expect(seedSource).toContain("ignoreDuplicates: true");
  });

  test("keeps the synthetic commit job linked to its immutable preview", () => {
    const jobsSource = sourceSection(
      '"csf-expanded-sheet-jobs"',
      '"csf-expanded-sheet-rows"',
    );
    const commitStart = jobsSource.indexOf("id: IDS.csfSheetJobCommit");
    const commitSource = jobsSource.slice(commitStart);

    expect(commitStart).toBeGreaterThanOrEqual(0);
    // The fixture seam takes the camelCase wire contract, not table columns: a
    // snake_case key is refused by its closed allowlist rather than silently
    // inserted as NULL.
    expect(commitSource).not.toContain("preview_job_id:");
    expect(commitSource).toContain("previewJobId: IDS.csfSheetJobPreview");
    // And the commit job states the semantics the tables require rather than
    // relying on a column default the fixture seam would otherwise apply.
    expect(commitSource).toContain('sourceType: "student_roster"');
    expect(commitSource).toContain("mappingVersion: 1");
  });

  test("resets every mutable lifecycle table before reseeding the CSF fixture", () => {
    const resetList = seedSource.slice(
      seedSource.indexOf("const csfTablesToReset"),
      seedSource.indexOf("for (const table of csfTablesToReset"),
    );
    for (const table of [
      "csf_storage_deletion_queue",
      "csf_application_correction_requests",
      "csf_application_private_notes",
      "csf_application_checks",
      "csf_dues_records",
      "csf_term_reopen_events",
      "csf_term_membership_outcomes",
      "csf_term_deadlines",
      "csf_term_policy_drafts",
    ]) {
      expect(resetList).toContain(`"${table}"`);
    }
    expect(resetList.indexOf('"csf_term_membership_outcomes"')).toBeLessThan(
      resetList.indexOf('"csf_term_memberships"'),
    );
    expect(resetList.indexOf('"csf_term_policy_drafts"')).toBeLessThan(
      resetList.indexOf('"csf_term_policies"'),
    );
  });

  test("seeds one local staff actor for every distinct CSF permission template", () => {
    const accountsSource = sourceSection(
      "const accounts = [",
      "const pluginKeys = [",
    );
    const staffActorKeys = [
      "csfAdviser",
      "csfCoPresidentOne",
      "csfCoPresidentTwo",
      "csfVpMembership",
      "csfVpPublicity",
      "csfVpClubs",
      "csfTreasurer",
      "csfSecretary",
      "csfWebMaster",
      "csfOfficer",
      "csfActivityCoordinatorTwo",
      "csfActivityCoordinatorThree",
      "csfActivityCoordinatorFour",
      "csfActivityCoordinatorFive",
      "csfDataManagement",
    ];

    for (const key of staffActorKeys) {
      const actorStart = accountsSource.indexOf(`key: "${key}"`);
      const actorSource = accountsSource.slice(actorStart, actorStart + 240);
      expect(actorStart, `Missing local actor: ${key}`).toBeGreaterThanOrEqual(
        0,
      );
      expect(actorSource).toContain('roles: [null, null, null, "staff"]');
      expect(actorSource).toContain("@local.test");
    }
  });

  test("keeps the Playwright actor emails aligned with the seeded role accounts", () => {
    const browserActorEmails = [
      "csf.admin@local.test",
      "csf.adviser@local.test",
      "csf.co-president-one@local.test",
      "csf.vp-membership@local.test",
      "csf.vp-publicity@local.test",
      "csf.vp-clubs@local.test",
      "csf.treasurer@local.test",
      "csf.secretary@local.test",
      "csf.web-master@local.test",
      "csf.officer@local.test",
      "csf.data-management@local.test",
      "csf.applicant@local.test",
    ];

    for (const email of browserActorEmails) {
      expect(seedSource).toContain(`email: "${email}"`);
      expect(actorHelperSource).toContain(`email: "${email}"`);
    }
  });

  test("seeds the canonical role templates and preserves their capability boundaries", () => {
    const rolesSource = sourceSection(
      "const seededRoles = [",
      '"csf-expanded-roles"',
    );
    const roleKeys = [
      "owner",
      "advisor",
      "co-president",
      "vice-president-membership",
      "vice-president-publicity",
      "vice-president-clubs",
      "treasurer",
      "secretary",
      "web-master",
      "activity-coordinator",
      "data-management",
    ];

    for (const key of roleKeys) {
      expect(rolesSource).toContain(`key: "${key}"`);
    }

    const treasurerStart = rolesSource.indexOf('key: "treasurer"');
    const treasurerEnd = rolesSource.indexOf(
      'key: "financial-secretary"',
      treasurerStart,
    );
    const treasurerSource = rolesSource.slice(treasurerStart, treasurerEnd);
    expect(treasurerSource).toContain('"view_applications"');
    expect(treasurerSource).toContain('"manage_payment_review"');
    expect(treasurerSource).toContain('"export_dues_reports"');
    expect(treasurerSource).not.toContain('"decide_applications"');

    const coordinatorStart = rolesSource.indexOf('key: "activity-coordinator"');
    const coordinatorEnd = rolesSource.indexOf(
      'key: "data-management"',
      coordinatorStart,
    );
    const coordinatorSource = rolesSource.slice(
      coordinatorStart,
      coordinatorEnd,
    );
    expect(coordinatorSource).toContain('"manage_opportunities"');
    expect(coordinatorSource).toContain('"verify_participation"');
    expect(coordinatorSource).not.toContain('"process_points"');
    expect(coordinatorSource).not.toContain('"verify_submissions"');
  });

  test("fills both Co-President seats and all five Activity Coordinator seats idempotently", () => {
    const staffSource = sourceSection(
      '"csf-expanded-staff"',
      "const seededApplications",
    );

    expect(
      occurrenceCount(staffSource, "role_id: IDS.csfRoleCoPresident"),
    ).toBe(2);
    expect(
      occurrenceCount(staffSource, "role_id: IDS.csfRoleActivityCoordinator"),
    ).toBe(5);
    expect(occurrenceCount(staffSource, 'status: "active"')).toBe(15);
    expect(staffSource).toContain('{ onConflict: "id" }');
  });
});

// ---------------------------------------------------------------------------
// Behavioral mode gate.
//
// The seed deletes and reset-upserts dozens of CSF tables, so "which stack does
// this run touch?" cannot be answered by reading the source. Every case below
// executes the real script against a fake Supabase CLI and asserts what the run
// actually did — including, for every refusal, that the fake CLI was never
// invoked at all. Zero CLI calls means no status, no credentials, no client, and
// therefore no database access.
// ---------------------------------------------------------------------------

const seedScript = new URL("./seed-platform.mjs", import.meta.url).pathname;
const BASE_PORT = 55320;
const PORT_OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7, 9];
const sandboxes: string[] = [];

afterAll(() => {
  for (const directory of sandboxes.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Answers `status -o env --workdir <dir>` from the generated config, and records
// every argv it was given so the scoping assertion has something to check.
const FAKE_SUPABASE = [
  "#!/bin/sh",
  'printf "%s\\n" "$*" >> "${FAKE_SUPABASE_CALLS:-/dev/null}"',
  'workdir=""',
  'prev=""',
  'for arg in "$@"; do',
  '  if [ "$prev" = "--workdir" ]; then workdir="$arg"; fi',
  '  prev="$arg"',
  "done",
  'api_port=""',
  'if [ -n "$workdir" ] && [ -f "$workdir/supabase/config.toml" ]; then',
  "  api_port=$(awk '/^\\[api\\]/{f=1} f && /^port = /{print $3; exit}' \"$workdir/supabase/config.toml\")",
  "else",
  "  api_port=54321",
  "fi",
  'case "$1" in',
  "  status)",
  '    printf \'API_URL="http://127.0.0.1:%s"\\n\' "$api_port"',
  "    printf 'ANON_KEY=\"fake-anon-token\"\\n'",
  "    printf 'SERVICE_ROLE_KEY=\"fake-service-role-token\"\\n'",
  '    printf \'DB_URL="postgresql://postgres:fake-password@127.0.0.1:%s/postgres"\\n\' "$((api_port + 1))"',
  "    ;;",
  "  *) exit 0 ;;",
  "esac",
  "",
].join("\n");

type Sandbox = { directory: string; fakeBin: string; calls: string };

function createSandbox(): Sandbox {
  const directory = mkdtempSync(join(tmpdir(), "csf-seed-mode-"));
  sandboxes.push(directory);
  const fakeBin = join(directory, "bin");
  mkdirSync(fakeBin);
  const target = join(fakeBin, "supabase");
  writeFileSync(target, FAKE_SUPABASE, { mode: 0o700 });
  return { directory, fakeBin, calls: join(directory, "supabase-calls.log") };
}

function createIsolatedWorkDir(
  sandbox: Sandbox,
  options: { name?: string; projectId?: string; marker?: string } = {},
) {
  const directory = join(sandbox.directory, options.name ?? "isolated");
  mkdirSync(directory, { mode: 0o700 });
  mkdirSync(join(directory, "supabase"), { mode: 0o700 });
  const projectId = options.projectId ?? "lets-assist-csf-browser-seedtest";
  const [
    shadow,
    api,
    database,
    studio,
    inbucket,
    smtp,
    inspector,
    analytics,
    pooler,
  ] = PORT_OFFSETS.map((offset) => BASE_PORT + offset);

  writeFileSync(
    join(directory, "supabase", "config.toml"),
    [
      `project_id = "${projectId}"`,
      "[api]",
      `port = ${api}`,
      "[db]",
      `port = ${database}`,
      `shadow_port = ${shadow}`,
      "[db.pooler]",
      `port = ${pooler}`,
      "[studio]",
      `port = ${studio}`,
      "[local_smtp]",
      `port = ${inbucket}`,
      `smtp_port = ${smtp}`,
      "[edge_runtime]",
      `inspector_port = ${inspector}`,
      "[analytics]",
      `port = ${analytics}`,
      // Provider-disabled by construction; the strict validator requires this
      // exact shape before it will call the directory an isolated stack.
      "[auth.external.google]",
      "enabled = false",
      'client_id = ""',
      'secret = ""',
      'redirect_uri = ""',
      "skip_nonce_check = false",
      "[auth.external.apple]",
      "enabled = false",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  const marker =
    options.marker ??
    [
      "state=ready",
      `project_id=${projectId}`,
      `base_port=${BASE_PORT}`,
      `work_dir=${directory}`,
      `db_volume=supabase_db_${projectId}`,
      `db_volume_project_label=${projectId}`,
      "",
    ].join("\n");
  const markerPath = join(directory, ".lets-assist-csf-isolated-stack");
  writeFileSync(markerPath, marker);
  chmodSync(markerPath, 0o600);

  return directory;
}

function runSeed(
  sandbox: Sandbox,
  env: Record<string, string>,
  args: string[] = ["--print-resolved-target"],
) {
  const result = Bun.spawnSync(
    [Bun.which("node") ?? "node", seedScript, ...args],
    {
      cwd: process.cwd(),
      env: {
        PATH: `${sandbox.fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        HOME: process.env.HOME ?? sandbox.directory,
        FAKE_SUPABASE_CALLS: sandbox.calls,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    calls: existsSync(sandbox.calls)
      ? readFileSync(sandbox.calls, "utf8").split("\n").filter(Boolean)
      : [],
  };
}

describe("platform seed requires an explicit, typo-safe mode", () => {
  test("a missing mode is refused before either environment helper is invoked", () => {
    const sandbox = createSandbox();
    const result = runSeed(sandbox, {});

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "PLATFORM_SEED_MODE is required and has no default",
    );
    // No CLI call at all: no status, no credentials, no client, no database.
    expect(result.calls).toEqual([]);
    expect(result.stdout).toBe("");
  });

  test("an empty or misspelled mode is refused before either environment helper is invoked", () => {
    for (const value of [
      "",
      "shared-local",
      "shared_local_v1",
      "csf-isolated",
      "csf-isolated-v2",
      "SHARED-LOCAL-V1",
      "isolated",
      "1",
    ]) {
      const sandbox = createSandbox();
      const result = runSeed(sandbox, { PLATFORM_SEED_MODE: value });

      expect(result.exitCode, `mode=${JSON.stringify(value)}`).not.toBe(0);
      expect(result.stderr).toMatch(
        value === ""
          ? /PLATFORM_SEED_MODE is required and has no default/u
          : /Unknown PLATFORM_SEED_MODE/u,
      );
      expect(result.calls, `mode=${JSON.stringify(value)}`).toEqual([]);
      expect(result.stdout).toBe("");
    }
  });

  test("shared mode refuses any isolated work directory", () => {
    const sandbox = createSandbox();
    const workDir = createIsolatedWorkDir(sandbox);
    const result = runSeed(sandbox, {
      PLATFORM_SEED_MODE: "shared-local-v1",
      CSF_ISOLATED_WORK_DIR: workDir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "PLATFORM_SEED_MODE=shared-local-v1 refuses CSF_ISOLATED_WORK_DIR",
    );
    expect(result.calls).toEqual([]);
    expect(result.stdout).toBe("");
  });

  test("isolated mode refuses a missing work directory instead of falling back to shared local", () => {
    const sandbox = createSandbox();
    const result = runSeed(sandbox, { PLATFORM_SEED_MODE: "csf-isolated-v1" });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "PLATFORM_SEED_MODE=csf-isolated-v1 requires CSF_ISOLATED_WORK_DIR",
    );
    expect(result.stderr).toContain(
      "never falls back to the shared local stack",
    );
    expect(result.calls).toEqual([]);
    expect(result.stdout).toBe("");
  });

  test("hosted development refuses Production, mismatched URLs, and isolated crossover", () => {
    const sandbox = createSandbox();
    const production = runSeed(sandbox, {
      PLATFORM_SEED_MODE: "hosted-development-v1",
      EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: "fotdmeakexgrkronxlof",
      NEXT_PUBLIC_SUPABASE_URL: "https://fotdmeakexgrkronxlof.supabase.co",
      SUPABASE_SECRET_KEY: "synthetic-test-only-key",
    });
    expect(production.exitCode).not.toBe(0);
    expect(production.stderr).toContain(
      "refuses the Production Supabase project ref",
    );

    const mismatch = runSeed(sandbox, {
      PLATFORM_SEED_MODE: "hosted-development-v1",
      EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      NEXT_PUBLIC_SUPABASE_URL: "https://qrstabcdefghijkl.supabase.co",
      SUPABASE_SECRET_KEY: "synthetic-test-only-key",
    });
    expect(mismatch.exitCode).not.toBe(0);
    expect(mismatch.stderr).toContain(
      "requires NEXT_PUBLIC_SUPABASE_URL to equal",
    );

    const crossover = runSeed(sandbox, {
      PLATFORM_SEED_MODE: "hosted-development-v1",
      CSF_ISOLATED_WORK_DIR: createIsolatedWorkDir(sandbox),
    });
    expect(crossover.exitCode).not.toBe(0);
    expect(crossover.stderr).toContain("refuses CSF_ISOLATED_WORK_DIR");
  });

  test("isolated mode refuses a forged, stale, or mismatched marker", () => {
    const cases: Array<[string, string]> = [
      [
        "forged project id",
        [
          "state=ready",
          "project_id=lets-assist",
          `base_port=${BASE_PORT}`,
          "work_dir=WORKDIR",
          "db_volume=supabase_db_lets-assist",
          "db_volume_project_label=lets-assist",
          "",
        ].join("\n"),
      ],
      [
        "stale transitional marker",
        [
          "state=starting",
          "project_id=lets-assist-csf-browser-seedtest",
          `base_port=${BASE_PORT}`,
          "work_dir=WORKDIR",
          "",
        ].join("\n"),
      ],
      [
        "mismatched base port",
        [
          "state=ready",
          "project_id=lets-assist-csf-browser-seedtest",
          "base_port=56350",
          "work_dir=WORKDIR",
          "db_volume=supabase_db_lets-assist-csf-browser-seedtest",
          "db_volume_project_label=lets-assist-csf-browser-seedtest",
          "",
        ].join("\n"),
      ],
      [
        "marker describing another directory",
        [
          "state=ready",
          "project_id=lets-assist-csf-browser-seedtest",
          `base_port=${BASE_PORT}`,
          `work_dir=${tmpdir()}`,
          "db_volume=supabase_db_lets-assist-csf-browser-seedtest",
          "db_volume_project_label=lets-assist-csf-browser-seedtest",
          "",
        ].join("\n"),
      ],
      [
        "unknown marker field",
        [
          "state=ready",
          "project_id=lets-assist-csf-browser-seedtest",
          `base_port=${BASE_PORT}`,
          "work_dir=WORKDIR",
          "db_volume=supabase_db_lets-assist-csf-browser-seedtest",
          "db_volume_project_label=lets-assist-csf-browser-seedtest",
          "adopted=true",
          "",
        ].join("\n"),
      ],
    ];

    for (const [label, markerTemplate] of cases) {
      const sandbox = createSandbox();
      const directory = join(sandbox.directory, "isolated");
      const marker = markerTemplate.replaceAll("WORKDIR", directory);
      createIsolatedWorkDir(sandbox, { marker });

      const result = runSeed(sandbox, {
        PLATFORM_SEED_MODE: "csf-isolated-v1",
        CSF_ISOLATED_WORK_DIR: directory,
      });

      expect(result.exitCode, label).not.toBe(0);
      expect(result.stdout, label).toBe("");
      // A refused marker must never have reached a status call, so no
      // credentials were ever read and no client could exist.
      expect(result.calls, label).toEqual([]);
    }
  });

  test("isolated mode scopes every status call to the validated generated work directory", () => {
    const sandbox = createSandbox();
    const workDir = createIsolatedWorkDir(sandbox);
    const result = runSeed(sandbox, {
      PLATFORM_SEED_MODE: "csf-isolated-v1",
      CSF_ISOLATED_WORK_DIR: workDir,
    });

    expect(result.exitCode).toBe(0);
    const statusCalls = result.calls.filter((call) =>
      call.startsWith("status"),
    );
    expect(statusCalls.length).toBeGreaterThan(0);
    // The scoped directory is the *resolved* one: the validator realpaths the
    // work directory before it trusts it, which on macOS turns /var into
    // /private/var.
    const resolvedWorkDir = realpathSync(workDir);
    for (const call of statusCalls) {
      // Never an unscoped local status: an unscoped call would report whichever
      // stack the CLI happened to select, including the shared 54321 one.
      expect(call).toContain(`--workdir ${resolvedWorkDir}`);
      expect(call).not.toBe("status -o env");
    }
    expect(result.calls.some((call) => call.includes("db reset"))).toBe(false);
    expect(result.calls.some((call) => call.includes("link"))).toBe(false);
  });

  test("a validated generated environment resolves to the exact intended local URL", () => {
    const sandbox = createSandbox();
    const workDir = createIsolatedWorkDir(sandbox);
    const result = runSeed(sandbox, {
      PLATFORM_SEED_MODE: "csf-isolated-v1",
      CSF_ISOLATED_WORK_DIR: workDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `mode=csf-isolated-v1\nurl=http://127.0.0.1:${BASE_PORT + 1}\n`,
    );
    // The introspection seam prints an origin and nothing else.
    expect(result.stdout).not.toContain("fake-service-role-token");
    expect(result.stdout).not.toContain("fake-anon-token");
    expect(result.stdout).not.toContain("fake-password");
  });

  test("every refusal happens before the fixture password is even evaluated", () => {
    // No CSF_LOCAL_TEST_PASSWORD / DV_LOCAL_TEST_PASSWORD is set anywhere in
    // these runs. If the mode gate ran after the password check, the error
    // would name the password instead of the mode.
    const sandbox = createSandbox();
    const result = runSeed(sandbox, {}, []);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("PLATFORM_SEED_MODE is required");
    expect(result.stderr).not.toContain("CSF_LOCAL_TEST_PASSWORD");
    expect(result.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Behavioral mode footprint.
//
// "shared local, non-CSF only" is a claim about what a 3,000-line script does,
// and no amount of reading it settles the question. Both cases below run the
// real script end to end against a recording client that performs no I/O, and
// assert the resulting ledger of database calls: shared local must contain zero
// DVHS CSF mutations, and isolated must still contain the deterministic
// synthetic CSF fixture contract the browser and replay path depends on.
// ---------------------------------------------------------------------------

type LedgerEntry = {
  seq: number;
  schema: string;
  table?: string;
  rpc?: string;
  op: string;
  rows?: number;
  email?: string;
};

function runSeedPlan(
  mode: "shared-local-v1" | "csf-isolated-v1" | "hosted-development-v1",
) {
  const sandbox = createSandbox();
  const ledgerPath = join(sandbox.directory, "plan-ledger.jsonl");
  const env: Record<string, string> = {
    PLATFORM_SEED_MODE: mode,
    PLATFORM_SEED_PLAN_ONLY: "hermetic-plan-v1",
    PLATFORM_SEED_PLAN_LEDGER: ledgerPath,
    CSF_LOCAL_TEST_PASSWORD: "hermetic-plan-fixture-password",
  };
  if (mode === "csf-isolated-v1") {
    env.CSF_ISOLATED_WORK_DIR = createIsolatedWorkDir(sandbox);
  } else if (mode === "hosted-development-v1") {
    env.EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
    env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    env.SUPABASE_SECRET_KEY = "synthetic-test-only-key";
  }

  const result = runSeed(sandbox, env, []);
  const entries: LedgerEntry[] = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LedgerEntry)
    : [];

  return { ...result, entries };
}

function csfEntries(entries: LedgerEntry[]) {
  return entries.filter(
    (entry) =>
      entry.schema === "plugin_data" ||
      (entry.table ?? "").startsWith("csf_") ||
      (entry.rpc ?? "").startsWith("csf_"),
  );
}

describe("seed modes have the footprint they claim", () => {
  const CSF_ORG_ID = "10000000-0000-4000-8000-000000000004";

  test("shared local mode performs zero DVHS CSF mutations", () => {
    const run = runSeedPlan("shared-local-v1");

    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.entries.length).toBeGreaterThan(0);

    // Not one plugin_data write, not one csf_* table, not one csf_* RPC.
    expect(csfEntries(run.entries)).toEqual([]);

    // And no CSF identity, organization, plugin, or membership record either.
    const emails = run.entries.map((entry) => entry.email).filter(Boolean);
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.filter((email) => email!.startsWith("csf."))).toEqual([]);
    expect(emails).toContain("platform.admin@local.test");

    // The non-CSF shared fixtures are all still there.
    const tables = run.entries.map((entry) => entry.table).filter(Boolean);
    for (const table of [
      "trusted_member",
      "organizations",
      "organization_members",
      "plugins",
      "organization_plugin_entitlements",
      "organization_plugin_installs",
      "projects",
    ]) {
      expect(tables, table).toContain(table);
    }

    expect(run.stdout).toContain(
      "shared local, non-CSF only: no DVHS CSF record was created, replaced, or deleted",
    );
  });

  test("isolated mode retains the deterministic synthetic CSF fixture contract", () => {
    const run = runSeedPlan("csf-isolated-v1");

    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);

    const csf = csfEntries(run.entries);
    expect(csf.length).toBeGreaterThan(50);

    // The owned synthetic import seam, the reset pass, and the fixture upserts.
    const rpcs = csf.map((entry) => entry.rpc).filter(Boolean);
    expect(rpcs).toContain("csf_seed_reset_synthetic_import");
    expect(rpcs).toContain("csf_seed_synthetic_import_fixture");

    const deleted = csf
      .filter((entry) => entry.op === "delete")
      .map((entry) => entry.table);
    for (const table of [
      "csf_storage_deletion_queue",
      "csf_term_memberships",
      "csf_point_submissions",
      "csf_roles",
    ]) {
      expect(deleted, table).toContain(table);
    }

    const upserted = csf
      .filter((entry) => entry.op === "upsert")
      .map((entry) => entry.table);
    for (const table of [
      "csf_roles",
      "csf_role_permissions",
      "csf_terms",
      "csf_cohorts",
      "csf_term_applications",
      "csf_term_meetings",
      "csf_opportunities",
      "csf_partner_clubs",
      "csf_admin_audit_events",
    ]) {
      expect(upserted, table).toContain(table);
    }

    // The CSF actors and the CSF organization are created in this mode only.
    const emails = run.entries.map((entry) => entry.email).filter(Boolean);
    expect(emails).toContain("csf.admin@local.test");
    expect(emails).toContain("csf.officer@local.test");
    expect(run.stdout).toContain(
      "csf-isolated-v1: deterministic synthetic DVHS CSF fixtures seeded",
    );
  });

  test("hosted development uses the same deterministic CSF footprint", () => {
    const isolated = runSeedPlan("csf-isolated-v1");
    const hosted = runSeedPlan("hosted-development-v1");
    expect(hosted.stderr).toBe("");
    expect(hosted.exitCode).toBe(0);
    expect(csfEntries(hosted.entries)).toEqual(csfEntries(isolated.entries));
    expect(hosted.stdout).toContain(
      "hosted-development-v1: deterministic synthetic DVHS CSF fixtures seeded",
    );
  });

  test("the shared and isolated plans differ only by the CSF footprint", () => {
    const shared = runSeedPlan("shared-local-v1");
    const isolated = runSeedPlan("csf-isolated-v1");

    const nonCsfTables = (entries: LedgerEntry[]) =>
      entries
        .filter((entry) => entry.schema === "public" && entry.table)
        .map((entry) => `${entry.op}:${entry.table}`);

    // Every non-CSF call the isolated plan makes, the shared plan makes too.
    expect(new Set(nonCsfTables(shared.entries))).toEqual(
      new Set(nonCsfTables(isolated.entries)),
    );
    expect(csfEntries(shared.entries).length).toBe(0);
    expect(csfEntries(isolated.entries).length).toBeGreaterThan(0);
  });

  test("the CSF organization ID never appears in a shared-mode call", () => {
    const run = runSeedPlan("shared-local-v1");
    const serialized = JSON.stringify(run.entries);
    expect(serialized).not.toContain(CSF_ORG_ID);
    expect(serialized).not.toContain("dvhs-csf");
  });

  test("the plan seam is unreachable without its exact opt-in value", () => {
    const sandbox = createSandbox();
    const ledgerPath = join(sandbox.directory, "plan-ledger.jsonl");
    for (const value of [
      undefined,
      "",
      "hermetic-plan",
      "HERMETIC-PLAN-V1",
      "1",
    ]) {
      const result = runSeed(
        sandbox,
        {
          PLATFORM_SEED_MODE: "shared-local-v1",
          PLATFORM_SEED_PLAN_LEDGER: ledgerPath,
          CSF_LOCAL_TEST_PASSWORD: "hermetic-plan-fixture-password",
          ...(value === undefined ? {} : { PLATFORM_SEED_PLAN_ONLY: value }),
        },
        [],
      );
      expect(result.exitCode, `PLATFORM_SEED_PLAN_ONLY=${value}`).not.toBe(0);
      expect(result.stderr).toContain(
        "PLATFORM_SEED_PLAN_LEDGER is a test-only seam",
      );
      // Refused before the environment helper, so no CLI call and no client.
      expect(result.calls).toEqual([]);
    }
    expect(existsSync(ledgerPath)).toBe(false);
  });
});

describe("package scripts carry the exact seed modes", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };

  test("the shared-local, isolated, and hosted seed scripts are distinct and exact", () => {
    expect(packageJson.scripts["supabase:seed:local-dev"]).toBe(
      "PLATFORM_SEED_MODE=shared-local-v1 node scripts/local-dev/seed-platform.mjs",
    );
    expect(packageJson.scripts["csf:seed:platform:isolated"]).toBe(
      "PLATFORM_SEED_MODE=csf-isolated-v1 node scripts/local-dev/seed-platform.mjs",
    );
    expect(packageJson.scripts["csf:seed:hosted-development"]).toBe(
      "PLATFORM_SEED_MODE=hosted-development-v1 node scripts/local-dev/seed-platform.mjs",
    );
  });

  test("the legitimate non-CSF shared bootstrap still uses the shared-local script", () => {
    expect(packageJson.scripts.supabase).toContain(
      "bun run supabase:seed:local-dev",
    );
    expect(packageJson.scripts.supabase).not.toContain(
      "csf:seed:platform:isolated",
    );
  });
});
