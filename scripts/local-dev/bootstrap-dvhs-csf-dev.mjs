#!/usr/bin/env node

/**
 * One-command local DVHS CSF development bootstrap.
 *
 * This is the human-facing entrypoint. It finds one already-running generated
 * CSF Supabase stack or creates a fresh one, seeds the fictional CSF fixture
 * corpus once, and then delegates to the provider-disabled Next.js runner.
 * Every database target still passes through dv-local-env.mjs, so convenience
 * never turns into a fallback to a hosted or shared project.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CSF_APP_ENV_KEYS,
  getCsfIsolatedSupabaseEnv,
  inspectCsfIsolatedWorkDir,
  loadCsfIsolatedAppEnvironment,
} from "./dv-local-env.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const STACK_PREFIX = "lets-assist-csf-browser-";
const START_SCRIPT = path.join(SCRIPT_DIR, "start-dvhs-csf-isolated-stack.sh");
const APP_RUNNER = path.join(SCRIPT_DIR, "run-dvhs-csf-isolated-app.mjs");
const SEED_SCRIPT = path.join(SCRIPT_DIR, "seed-platform.mjs");
const PASSWORD_FILE = "csf-local-test-password";
const SEEDED_MARKER = "csf-platform-fixtures-v2.seeded";
const MIGRATION_FILE_PATTERN = /^(\d{14})_[^/]+\.sql$/u;

class StaleMigrationStackError extends Error {
  constructor(message) {
    super(message);
    this.name = "StaleMigrationStackError";
  }
}

export const BOOTSTRAP_OS_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
  "USER",
  "SHELL",
  "TERM",
];

function positiveRuntimeEnvironment(hostEnv = process.env) {
  const result = {};
  for (const key of BOOTSTRAP_OS_ENV_KEYS) {
    const value = hostEnv[key];
    if (typeof value === "string" && value !== "") result[key] = value;
  }
  return result;
}

function assertOwnerOnlyRegularFile(target) {
  const stats = lstatSync(target);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(
      `Refusing a non-regular local CSF bootstrap file: ${target}`,
    );
  }
  if ((stats.mode & 0o777) !== 0o600) {
    throw new Error(`Local CSF bootstrap file must be mode 600: ${target}`);
  }
  if (stats.nlink !== 1) {
    throw new Error(
      `Local CSF bootstrap file must have exactly one hard link: ${target}`,
    );
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(
      `Refusing a local CSF bootstrap file owned by another user: ${target}`,
    );
  }
}

/**
 * Candidate discovery is intentionally narrow: direct children of the OS temp
 * directory carrying the generated project prefix. Validation below proves the
 * marker, config, Docker identity, app environment, and running CLI status.
 */
export function candidateWorkDirectories(tempRoot = tmpdir()) {
  if (!existsSync(tempRoot)) return [];
  return readdirSync(tempRoot, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(STACK_PREFIX),
    )
    .map((entry) => path.join(tempRoot, entry.name))
    .sort();
}

function migrationVersionsInDirectory(directory) {
  const versions = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.match(MIGRATION_FILE_PATTERN)?.[1])
    .filter((version) => typeof version === "string")
    .sort();
  if (new Set(versions).size !== versions.length) {
    throw new Error(`Duplicate migration version found in ${directory}.`);
  }
  return versions;
}

export function assertMigrationVersionParity({
  repositoryVersions,
  isolatedVersions,
  appliedVersions,
}) {
  const expected = JSON.stringify([...repositoryVersions].sort());
  const copied = JSON.stringify([...isolatedVersions].sort());
  const applied = JSON.stringify([...appliedVersions].sort());
  if (copied !== expected || applied !== expected) {
    throw new StaleMigrationStackError(
      "The running isolated CSF stack does not match the current repository migration tree.",
    );
  }
}

function assertCurrentRepositoryMigrations(workDir) {
  const repositoryVersions = migrationVersionsInDirectory(
    path.join(REPO_ROOT, "supabase", "migrations"),
  );
  const isolatedVersions = migrationVersionsInDirectory(
    path.join(workDir, "supabase", "migrations"),
  );
  const result = spawnSync(
    "supabase",
    [
      "--workdir",
      workDir,
      "--output-format",
      "json",
      "migration",
      "list",
      "--local",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Could not read the isolated stack migration history.");
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error("The isolated stack migration history was not valid JSON.");
  }
  const migrations = Array.isArray(payload?.migrations)
    ? payload.migrations
    : [];
  const appliedVersions = migrations
    .map((migration) => migration?.remote)
    .filter((version) => typeof version === "string" && version.length > 0);
  assertMigrationVersionParity({
    repositoryVersions,
    isolatedVersions,
    appliedVersions,
  });
}

export function findReusableWorkDirectories(
  candidates,
  validate = (candidate) => {
    const isolated = inspectCsfIsolatedWorkDir(candidate);
    // A retained marker from a previously stopped stack is normal. Check the
    // exact recorded database container quietly before asking the CLI for its
    // status, avoiding scary "No such container" output during discovery.
    const container = spawnSync(
      "docker",
      ["inspect", `supabase_db_${isolated.projectId}`],
      {
        stdio: "ignore",
      },
    );
    if (container.status !== 0)
      throw new Error("isolated database container is stopped");
    getCsfIsolatedSupabaseEnv({ CSF_ISOLATED_WORK_DIR: isolated.workDir });
    loadCsfIsolatedAppEnvironment(isolated.workDir);
    assertCurrentRepositoryMigrations(isolated.workDir);
    return isolated.workDir;
  },
  onRejected = /** @type {(candidate: string, error: unknown) => void} */ (
    () => {}
  ),
) {
  const reusable = [];
  for (const candidate of candidates) {
    try {
      reusable.push(validate(candidate));
    } catch (error) {
      onRejected(candidate, error);
      // Retained evidence from a stopped or failed stack is expected. It is not
      // reusable and is never deleted or adopted here.
    }
  }
  return [...new Set(reusable.map((candidate) => realpathSync(candidate)))];
}

export function selectReusableWorkDirectory(reusable) {
  if (reusable.length === 0) return null;
  if (reusable.length > 1) {
    throw new Error(
      `Found ${reusable.length} running isolated CSF stacks. Stop all but one before starting the app:\n${reusable.join("\n")}`,
    );
  }
  return reusable[0];
}

export function ensureFixturePassword(workDir) {
  const target = path.join(workDir, PASSWORD_FILE);
  if (!existsSync(target)) {
    const password = `${randomBytes(18).toString("base64url")}Aa1!`;
    let descriptor;
    try {
      descriptor = openSync(target, "wx", 0o600);
      writeFileSync(descriptor, `${password}\n`, "utf8");
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  assertOwnerOnlyRegularFile(target);
  const password = readFileSync(target, "utf8").trim();
  if (password.length < 16 || /[\r\n]/u.test(password)) {
    throw new Error("The generated local CSF fixture password is malformed.");
  }
  return password;
}

function createFreshStack() {
  const runId = `dv${randomBytes(7).toString("hex")}`;
  const workDir = path.join(tmpdir(), `${STACK_PREFIX}${runId}`);
  const result = spawnSync(START_SCRIPT, [], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CSF_ISOLATED_RUN_ID: runId,
      CSF_ISOLATED_WORK_DIR: workDir,
      CSF_ISOLATED_ANALYTICS_MODE: "disabled",
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `The isolated Supabase launcher exited with code ${result.status}.`,
    );
  }
  return inspectCsfIsolatedWorkDir(workDir).workDir;
}

function resolveWorkDirectory() {
  const requested = process.env.CSF_ISOLATED_WORK_DIR?.trim();
  if (requested) {
    const isolated = inspectCsfIsolatedWorkDir(requested);
    getCsfIsolatedSupabaseEnv({ CSF_ISOLATED_WORK_DIR: isolated.workDir });
    assertCurrentRepositoryMigrations(isolated.workDir);
    return isolated.workDir;
  }

  const staleMigrationStacks = [];
  const reusable = findReusableWorkDirectories(
    candidateWorkDirectories(),
    undefined,
    (candidate, error) => {
      if (error instanceof StaleMigrationStackError)
        staleMigrationStacks.push(candidate);
    },
  );
  if (staleMigrationStacks.length > 0) {
    throw new Error(
      "Found a running isolated CSF stack built from a different migration tree. " +
        "Stop it with scripts/local-dev/stop-dvhs-csf-isolated-stack.sh before starting the current tree:\n" +
        staleMigrationStacks.join("\n"),
    );
  }
  return selectReusableWorkDirectory(reusable) ?? createFreshStack();
}

function seedFixturesOnce(workDir, password) {
  const marker = path.join(workDir, SEEDED_MARKER);
  const forceReseed = process.env.CSF_LOCAL_RESEED === "1";
  const markerExists = existsSync(marker);
  if (markerExists) assertOwnerOnlyRegularFile(marker);
  if (markerExists && !forceReseed) {
    console.log(
      "Synthetic CSF fixtures are already present; preserving your local edits.",
    );
    return;
  }

  const appEnv = loadCsfIsolatedAppEnvironment(workDir);
  const seedEnv = positiveRuntimeEnvironment();
  for (const key of CSF_APP_ENV_KEYS) seedEnv[key] = appEnv[key];
  seedEnv.PLATFORM_SEED_MODE = "csf-isolated-v1";
  seedEnv.CSF_LOCAL_TEST_PASSWORD = password;

  console.log(
    forceReseed
      ? "Re-seeding synthetic CSF fixtures..."
      : "Seeding synthetic CSF fixtures...",
  );
  const result = spawnSync(process.execPath, [SEED_SCRIPT], {
    cwd: REPO_ROOT,
    env: seedEnv,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `The synthetic CSF fixture seed exited with code ${result.status}.`,
    );
  }

  if (!markerExists) {
    writeFileSync(marker, "seed=csf-platform-fixtures-v2\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }
  assertOwnerOnlyRegularFile(marker);
}

function printHandoff(workDir, password) {
  console.log("\nDVHS CSF local workspace is ready");
  console.log("  app      : http://localhost:3000/login");
  console.log(`  work dir : ${workDir}`);
  console.log(`  password : ${password}`);
  console.log("  officer  : csf.officer@local.test (CSF Officer)");
  console.log("  member   : student.2028@local.test (Aarav Mehta)");
  console.log("  applicant: csf.applicant@local.test (Evan Chen)");
  console.log("  admin    : csf.admin@local.test (CSF Admin)");
  console.log(
    "  dataset  : Maya Patel, Priya Shah, Sofia, three classes, two terms, meetings, activities, points, applications, clubs, and imports",
  );
  console.log("  reseed   : CSF_LOCAL_RESEED=1 bun run dev\n");
}

async function runApp(workDir) {
  const serverMode = process.env.CSF_BROWSER_SERVER_MODE ?? "development";
  if (serverMode !== "development" && serverMode !== "production") {
    throw new Error(`Unknown isolated browser server mode: ${serverMode}`);
  }
  const child = spawn(process.execPath, [APP_RUNNER], {
    cwd: REPO_ROOT,
    env: {
      ...positiveRuntimeEnvironment(),
      CSF_ISOLATED_WORK_DIR: workDir,
      CSF_BROWSER_SERVER_MODE: serverMode,
    },
    stdio: "inherit",
  });
  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => child.kill(signal);
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  for (const [signal, handler] of signalHandlers) {
    process.removeListener(signal, handler);
  }
  process.exitCode = result.signal ? 1 : (result.code ?? 1);
}

async function main() {
  const workDir = resolveWorkDirectory();
  const password = ensureFixturePassword(workDir);
  seedFixturesOnce(workDir, password);
  printHandoff(workDir, password);
  await runApp(workDir);
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return (
      path.resolve(process.argv[1]) ===
      path.resolve(fileURLToPath(import.meta.url))
    );
  }
}

if (isEntrypoint()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
