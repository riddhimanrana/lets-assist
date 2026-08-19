#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const PRODUCTION_SUPABASE_PROJECT_REF = "fotdmeakexgrkronxlof";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const fixtureSeamSql = resolve("supabase/seeds/local-only.sql");
const platformSeeder = resolve("scripts/local-dev/seed-platform.mjs");

const cleanupSql = `
DROP FUNCTION IF EXISTS plugin_data.csf_seed_synthetic_import_fixture(uuid, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS plugin_data.csf_seed_reset_synthetic_import(uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_assert_fixture_owner(text, regclass, uuid, uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_assert_fixture_reference(text, uuid, regclass, uuid, boolean);
DROP FUNCTION IF EXISTS plugin_data.csf_assert_fixture_keys(text, jsonb, text[]);
DROP FUNCTION IF EXISTS plugin_data.csf_assert_synthetic_fixture_scope(uuid);
DROP FUNCTION IF EXISTS plugin_data.csf_is_synthetic_fixture_id(uuid);
NOTIFY pgrst, 'reload schema';
`;

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    fail(`${command} failed${detail ? `: ${detail}` : "."}`);
  }

  return result.stdout;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function resolveBranch() {
  const projectRef = required(
    "EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF",
  ).toLowerCase();
  if (!/^[a-z0-9]{20}$/u.test(projectRef)) {
    fail("EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF is malformed.");
  }
  if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    fail("Hosted Development seeding refuses the Production project ref.");
  }

  const branchId = required("SUPABASE_BRANCH_ID");
  if (!UUID_PATTERN.test(branchId)) fail("SUPABASE_BRANCH_ID is malformed.");

  // An unlinked worktree gives the CLI no project ref to infer, so the branch
  // lookup names its parent project explicitly. The parent may legitimately be
  // the Supabase parent project; only the seed target ref above is refused.
  const parentProjectRef = required(
    "SUPABASE_PARENT_PROJECT_REF",
  ).toLowerCase();
  if (!/^[a-z0-9]{20}$/u.test(parentProjectRef)) {
    fail("SUPABASE_PARENT_PROJECT_REF is malformed.");
  }

  const raw = run("supabase", [
    "branches",
    "get",
    branchId,
    "--project-ref",
    parentProjectRef,
    "--experimental",
    "--output",
    "json",
  ]);
  const branch = JSON.parse(raw);
  const expectedUrl = `https://${projectRef}.supabase.co`;

  if (branch.SUPABASE_URL !== expectedUrl) {
    fail(
      `Supabase branch ${branchId} resolves to a different API origin; expected ${expectedUrl}.`,
    );
  }
  if (!branch.POSTGRES_URL_NON_POOLING || !branch.SUPABASE_SERVICE_ROLE_KEY) {
    fail("Supabase branch credentials are incomplete.");
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(branch.POSTGRES_URL_NON_POOLING);
  } catch {
    fail("Supabase branch database URL is malformed.");
  }
  if (
    databaseUrl.protocol !== "postgresql:" ||
    databaseUrl.hostname !== `db.${projectRef}.supabase.co`
  ) {
    fail("Supabase branch database URL belongs to a different project ref.");
  }

  return {
    databaseUrl: branch.POSTGRES_URL_NON_POOLING,
    serviceRoleKey: branch.SUPABASE_SERVICE_ROLE_KEY,
    url: expectedUrl,
  };
}

function psql(databaseUrl, args, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return run(
        "psql",
        [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args],
        {
          env: { ...process.env, PGCONNECT_TIMEOUT: "10" },
          stdio: ["pipe", "pipe", "pipe"],
          ...options,
        },
      );
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        /timeout expired|connection .*failed|connection refused|could not translate host name/iu.test(
          message,
        );
      if (!retryable || attempt === 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
    }
  }

  throw lastError;
}

async function main() {
  fail(
    "Hosted Development fixture seeding is disabled. Use isolated local/CI fixtures; inspect hosted rows with a read-only cleanup preview before any reviewed cleanup.",
  );

  /* c8 ignore start -- retained only as inert historical implementation notes */
  required("CSF_LOCAL_TEST_PASSWORD");
  const branch = resolveBranch();
  let seamInstalled = false;

  try {
    psql(branch.databaseUrl, ["-f", fixtureSeamSql]);
    seamInstalled = true;
    psql(branch.databaseUrl, ["-c", "NOTIFY pgrst, 'reload schema';"]);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));

    run(process.execPath, [platformSeeder], {
      env: {
        ...process.env,
        PLATFORM_SEED_MODE: "hosted-development-v1",
        NEXT_PUBLIC_SUPABASE_URL: branch.url,
        SUPABASE_SERVICE_ROLE_KEY: branch.serviceRoleKey,
      },
      stdio: "inherit",
    });
  } finally {
    if (seamInstalled) {
      psql(branch.databaseUrl, [], { input: cleanupSql });
    }
  }
  /* c8 ignore stop */
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
