#!/usr/bin/env node

/**
 * The isolated DVHS CSF app runner.
 *
 * `bun run dev -- --port 3000` was never a safe instruction for this path. It
 * starts Next in the operator's own environment: every provider key exported in
 * that shell, plus every key any repository `.env*` file declares, reaches the
 * server. On a stack whose entire premise is that it touches nothing real, that
 * is the wrong default in the worst place.
 *
 * This runner replaces it with three claims it can actually keep:
 *
 *   1. the child environment is built from a positive allowlist — `process.env`
 *      is never spread, so a provider key is absent because it was never copied
 *      rather than because someone remembered to delete it;
 *   2. every key the repository's `.env*` files declare is discovered through a
 *      real `@next/env` load in a sterile child process and explicitly shadowed
 *      unless it is one of the validated or generated local-safe values, so
 *      `.env.local` cannot smuggle a credential past the allowlist;
 *   3. the fixed app port 3000 is owned through one atomic per-user claim held
 *      for the child's lifetime, and released only by the process that can prove
 *      it took it.
 *
 * It never spawns `bun run dev`: Next is started directly through this Node
 * executable so there is no intermediate shell to re-read a profile.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CSF_APP_ENV_KEYS,
  CSF_ISOLATED_APP_PORT,
  inspectCsfIsolatedWorkDir,
  loadCsfIsolatedAppEnvironment,
} from "./dv-local-env.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const EGRESS_GUARD = path.join(SCRIPT_DIR, "cron-egress-guard.cjs");

export const APP_PORT = CSF_ISOLATED_APP_PORT;
export const APP_PORT_CLAIM_NAME = `app-port-${APP_PORT}`;

/**
 * The only host variables any isolated child inherits. Everything else is
 * absent because it was never copied.
 */
export const OS_RUNTIME_KEYS = [
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

/**
 * Every worker switch this repository currently reads, forced off. This is a
 * closed set on purpose: a new worker flag that is not listed here is a gap, and
 * scripts/local-dev/run-dvhs-csf-isolated-app.test.ts rediscovers the repository's
 * `*_ENABLED` flags and fails when one is missing.
 */
export const DISABLED_WORKER_ENV_KEYS = [
  "AUTO_PUBLISH_ENABLED",
  "PROJECT_CANCELLATION_WORKER_ENABLED",
  "ORG_CALENDAR_SYNC_WORKER_ENABLED",
  "ORG_SHEET_SYNC_WORKER_ENABLED",
  "CSF_COMMUNICATIONS_WORKER_ENABLED",
];

/**
 * Provider and hosted-runtime keys, always shadowed to the empty string whether
 * or not any `.env*` file declares them.
 *
 * Empty rather than deleted is deliberate. `@next/env` only applies a key from a
 * `.env*` file when that key is `undefined` in the initial environment, so an
 * explicitly empty value is what makes the file's value unreachable; deleting
 * the key would hand the decision straight back to `.env.local`.
 */
export const DISABLED_PROVIDER_ENV_KEYS = [
  // Resend
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  // Google: OAuth, Calendar, Drive, Sheets, Maps, Picker
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_OAUTH_STATE_SECRET",
  "GOOGLE_CAP_CLIENT_IDS",
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
  "NEXT_PUBLIC_GOOGLE_PICKER_API_KEY",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI",
  // Stripe
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  // PostHog
  "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
  // Turnstile — bypassed locally, so the real keys must not be present at all
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  // Remote/hosted Supabase and the hosted-runtime markers the cron probe reads
  "NEXT_PUBLIC_REMOTE_SUPABASE_URL",
  "NEXT_PUBLIC_REMOTE_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_REMOTE_SUPABASE_PUBLISHABLE_KEY",
  "REMOTE_PREVIEW_USER_ID_MAP",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_REF",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_GIT_COMMIT_SHA",
  // OpenTelemetry exporters
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
];

const LOCAL_MAIL_FROM = "Let's Assist <no-reply@local.lets-assist.test>";

/** Cron token keys, set only in the cron-probe child. */
const CRON_TOKEN_KEYS = [
  "CRON_TOKEN",
  "CRON_SECRET",
  "AUTO_PUBLISH_SECRET_TOKEN",
  "PROJECT_CANCELLATION_WORKER_SECRET_TOKEN",
  "ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN",
  "ORG_SHEET_SYNC_WORKER_SECRET_TOKEN",
  "CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN",
];

// ---------------------------------------------------------------------------
// Repository `.env*` discovery — a real @next/env load, in a sterile child.
// ---------------------------------------------------------------------------

// `@next/env` writes every parsed key into the *loading* process's environment,
// so discovering keys in-process would pollute the very environment this runner
// exists to keep clean. The child is given nothing but PATH and a development
// NODE_ENV, and prints key names only — never a value.
const ENV_KEY_DISCOVERY_SOURCE = [
  'const { loadEnvConfig } = require("@next/env");',
  "const quiet = { info() {}, warn() {}, error() {} };",
  "const { loadedEnvFiles } = loadEnvConfig(process.cwd(), true, quiet, true);",
  "const keys = new Set();",
  "for (const file of loadedEnvFiles) {",
  "  for (const key of Object.keys(file.env || {})) keys.add(key);",
  "}",
  'process.stdout.write([...keys].sort().join("\\n"));',
].join("\n");

/**
 * @param {string} [repoRoot]
 * @returns {string[]} every key any repository `.env*` file declares
 */
export function discoverRepositoryEnvFileKeys(repoRoot = REPO_ROOT) {
  // A real node, so the discovery resolves `@next/env` exactly the way the Next
  // server about to be started will.
  const result = spawnSync(resolveNodeExecutable(), ["-e", ENV_KEY_DISCOVERY_SOURCE], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      NODE_ENV: "development",
    },
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    // Failing closed matters more here than anywhere else: an unproven
    // discovery means unproven shadowing, which means a `.env.local` value
    // could reach the child unnoticed.
    throw new Error(
      `Sterile @next/env discovery failed (exit ${result.status}); refusing to start an app whose .env* keys are unknown.`,
    );
  }

  return result.stdout.split("\n").map((key) => key.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Positive child environment
// ---------------------------------------------------------------------------

/**
 * One builder for both isolated children: the app runner and the five-route cron
 * harness. They differ only in what they are allowed to reach, never in how the
 * environment is constructed.
 *
 * @param {{
 *   mode: "isolated-app" | "cron-probe",
 *   appEnv: Record<string, string>,
 *   isolated: { basePort: number, apiPort: number, databasePort: number, smtpPort: number },
 *   port: number,
 *   ledgerPath: string,
 *   envFileKeys?: string[],
 *   secret?: string,
 *   probeMode?: string,
 *   workDirOverride?: string,
 *   serverMode?: "development" | "production",
 *   hostEnv?: Record<string, string | undefined>,
 * }} options
 */
export function buildIsolatedChildEnvironment(options) {
  const {
    mode,
    appEnv,
    isolated,
    port,
    ledgerPath,
    envFileKeys = [],
    secret,
    probeMode,
    workDirOverride,
    serverMode = "development",
    hostEnv = process.env,
  } = options;

  if (mode !== "isolated-app" && mode !== "cron-probe") {
    throw new Error(`Unknown isolated child environment mode: ${mode}`);
  }
  if (mode === "cron-probe" && (!secret || !probeMode)) {
    throw new Error("The cron-probe child environment requires a run-scoped secret and probe mode.");
  }
  if (serverMode !== "development" && serverMode !== "production") {
    throw new Error(`Unknown isolated browser server mode: ${serverMode}`);
  }

  /** @type {Record<string, string>} */
  const childEnv = {};

  for (const key of OS_RUNTIME_KEYS) {
    const value = hostEnv[key];
    if (typeof value === "string" && value !== "") childEnv[key] = value;
  }

  for (const key of CSF_APP_ENV_KEYS) {
    const value = appEnv[key];
    if (typeof value !== "string" || value === "") {
      throw new Error(`Validated isolated app environment is missing ${key}.`);
    }
    childEnv[key] = value;
  }
  // The decoy identity replaces exactly one value, so the phase that uses it
  // isolates the variable under test and nothing else.
  if (workDirOverride) childEnv.CSF_ISOLATED_WORK_DIR = workDirOverride;

  // Generated local-safe values. Every one of these is either a constant, a
  // loopback endpoint derived from the validated marker, or an explicit "off".
  childEnv.NODE_ENV = serverMode;
  childEnv.NEXT_TELEMETRY_DISABLED = "1";
  // Cron probes are terminated as soon as their one request completes. Sharing
  // their partially-written development output with a later browser server can
  // leave Webpack's module table inconsistent (for example, "undefined.call")
  // even though the database remains healthy. Keep the two process lifecycles
  // in separate, bounded directories.
  childEnv.NEXT_DIST_DIR =
    mode === "cron-probe"
      ? ".next-csf-isolated/cron-probe"
      : ".next-csf-isolated/browser-app";
  childEnv.CSF_LOCAL_FIXTURE_MODE = "1";
  childEnv.PORT = String(port);
  childEnv.EMAIL_TRANSPORT = "mailpit";
  childEnv.EMAIL_FROM = LOCAL_MAIL_FROM;
  childEnv.MAILPIT_HOST = "127.0.0.1";
  childEnv.MAILPIT_SMTP_PORT = String(isolated.smtpPort);
  childEnv.MAILPIT_FROM_EMAIL = LOCAL_MAIL_FROM;
  childEnv.TURNSTILE_BYPASS = "true";
  childEnv.NEXT_PUBLIC_TURNSTILE_BYPASS = "true";
  childEnv.DV_TABROOM_LIVE = "0";
  for (const key of DISABLED_WORKER_ENV_KEYS) childEnv[key] = "false";

  // Guard wiring, shared by both children.
  childEnv.CRON_EGRESS_LEDGER = ledgerPath;
  childEnv.NODE_OPTIONS = `--require ${EGRESS_GUARD}`;
  // The isolated Mailpit port is always *declared* as SMTP. Only the app runner
  // then permits it; the cron harness leaves it refused, so "the mail went to
  // Mailpit" can never stand in for "no provider was contacted".
  childEnv.CRON_EGRESS_SMTP_PORTS = String(isolated.smtpPort);
  if (mode === "isolated-app") {
    childEnv.CRON_EGRESS_ALLOWED_SMTP_PORTS = String(isolated.smtpPort);
    // Loopback Supabase, loopback database, loopback Mailpit, and the local app.
    // Nothing else, not even another loopback port.
    childEnv.CRON_EGRESS_ALLOWED_LOOPBACK_PORTS = [
      isolated.apiPort,
      isolated.databasePort,
      isolated.smtpPort,
      port,
    ].join(",");
  }

  if (mode === "cron-probe") {
    for (const key of CRON_TOKEN_KEYS) childEnv[key] = secret;
    childEnv.CRON_AUTH_SHAPE_PROBE_ONLY = probeMode;
  }

  // Provider and hosted-runtime keys are shadowed unconditionally.
  for (const key of DISABLED_PROVIDER_ENV_KEYS) {
    if (Object.hasOwn(childEnv, key)) {
      throw new Error(
        `${key} is both a local-safe value and a disabled provider key; refusing an ambiguous child environment.`,
      );
    }
    childEnv[key] = "";
  }

  // Then every key the repository's `.env*` files declare that is not one of the
  // validated or generated local-safe values above.
  const shadowedEnvFileKeys = [];
  for (const key of envFileKeys) {
    if (Object.hasOwn(childEnv, key)) continue;
    childEnv[key] = "";
    shadowedEnvFileKeys.push(key);
  }

  return { childEnv, shadowedEnvFileKeys };
}

// ---------------------------------------------------------------------------
// Next, started directly through Node
// ---------------------------------------------------------------------------

/**
 * A real `node`, never an ambient `bun run dev`. Going through a package script
 * adds a shell that re-reads a profile and a runtime that loads `.env*` files of
 * its own — two more ways for a value this runner deliberately shadowed to come
 * back.
 */
export function resolveNodeExecutable() {
  const base = path.basename(process.execPath);
  if (base === "node" || base === "node.exe") return process.execPath;

  const found = spawnSync("node", ["-e", "process.stdout.write(process.execPath)"], {
    encoding: "utf8",
  });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  throw new Error(
    "The isolated DVHS CSF children require a real node executable on PATH.",
  );
}

/**
 * @param {number} port
 * @param {string} [repoRoot]
 * @param {"webpack" | "turbopack"} [bundler]
 */
export function resolveNextDevCommand(port, repoRoot = REPO_ROOT, bundler = "webpack") {
  const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    throw new Error(`Missing the local Next executable: ${nextBin}`);
  }
  if (bundler !== "webpack" && bundler !== "turbopack") {
    throw new Error(`Unknown isolated Next bundler: ${bundler}`);
  }
  return {
    command: resolveNodeExecutable(),
    // Next 16 defaults to Turbopack, whose compiler child opens an ephemeral
    // loopback IPC socket. The isolated runner intentionally permits only its
    // declared Supabase, database, Mailpit, and app ports, so that internal
    // socket correctly fails closed. Webpack is the supported Next CLI fallback
    // and keeps compilation in-process without widening the egress allowlist.
    // The cron-only harness opts into Turbopack separately: its guard permits
    // loopback compiler IPC, and Turbopack defers Next's remote version lookup
    // until a browser HMR connection exists. That harness never opens one.
    args: [
      nextBin,
      "dev",
      bundler === "webpack" ? "--webpack" : "--turbopack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
  };
}

/**
 * Build and serve the browser suite through Next's production runtime. CI uses
 * this path so authenticated Server Actions are never coupled to a cold HMR
 * compiler generation. Both commands still run in the same provider-disabled
 * isolated environment as the development server.
 *
 * @param {number} port
 * @param {string} [repoRoot]
 */
export function resolveNextProductionCommands(port, repoRoot = REPO_ROOT) {
  const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextBin)) {
    throw new Error(`Missing the local Next executable: ${nextBin}`);
  }
  const command = resolveNodeExecutable();
  return {
    build: { command, args: [nextBin, "build", "--webpack"] },
    start: {
      command,
      args: [
        nextBin,
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Port ownership
// ---------------------------------------------------------------------------

/**
 * Refuse an occupied port rather than adopting whatever answers on it. An
 * adopted server is a server whose environment, workers, and credentials are
 * unknown — exactly what this runner exists to bound.
 *
 * @param {number} port
 */
export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `Refusing to adopt a server already listening on 127.0.0.1:${port}.`
            : `Could not claim 127.0.0.1:${port}: ${error.message}`,
        ),
      );
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve());
    });
  });
}

/**
 * The same global-per-user allocator root the isolated launcher uses. It is
 * deliberately not TMPDIR-derived: two shells with different TMPDIR values still
 * contend for the same host port.
 */
export function appPortClaimRoot(env = process.env) {
  const override = env.CSF_ISOLATED_CLAIM_ROOT;
  if (override) {
    if (env.CSF_ISOLATED_TEST_CLAIM_ROOT !== "hermetic-test") {
      throw new Error(
        "CSF_ISOLATED_CLAIM_ROOT is a test-only override; it requires CSF_ISOLATED_TEST_CLAIM_ROOT=hermetic-test.",
      );
    }
    return override;
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : "shared";
  return `/tmp/lets-assist-csf-isolated-claims-${uid}`;
}

function assertPrivateDirectory(target) {
  const stats = lstatSync(target);
  if (stats.isSymbolicLink()) throw new Error(`Refusing a symlinked claim path: ${target}`);
  if (!stats.isDirectory()) throw new Error(`Refusing a non-directory claim path: ${target}`);
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(`Refusing a claim directory owned by another user: ${target}`);
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(`Refusing a group/world-accessible claim directory: ${target}`);
  }
}

/**
 * One atomic `mkdir` — never `mkdir -p` — plus a run-scoped ownership token, so
 * release can prove the claim being removed is the claim this process took.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function claimAppPort(env = process.env) {
  const claimRoot = appPortClaimRoot(env);
  mkdirSync(claimRoot, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(claimRoot);

  const claimPath = path.join(claimRoot, APP_PORT_CLAIM_NAME);
  try {
    mkdirSync(claimPath, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `Another isolated app runner already owns port ${APP_PORT}. Claim directory: ${claimPath}`,
      );
    }
    throw error;
  }
  assertPrivateDirectory(claimPath);

  const token = randomBytes(16).toString("hex");
  const ownerPath = path.join(claimPath, "owner");
  writeFileSync(ownerPath, `pid=${process.pid}\ntoken=${token}\n`, { mode: 0o600 });

  return { claimPath, ownerPath, token };
}

/**
 * Remove only this process's own claim. A claim whose owner file is missing,
 * unreadable, or carries someone else's token is left exactly where it is:
 * a stale claim is recoverable, a stolen one is not.
 *
 * @param {{ claimPath: string, ownerPath: string, token: string }} claim
 */
export function releaseAppPort(claim) {
  let recorded = "";
  try {
    recorded = readFileSync(claim.ownerPath, "utf8");
  } catch {
    console.error(
      `Refusing to remove ${claim.claimPath}: its ownership record could not be read.`,
    );
    return false;
  }
  if (!recorded.includes(`token=${claim.token}\n`)) {
    console.error(
      `Refusing to remove ${claim.claimPath}: it no longer carries this runner's ownership token.`,
    );
    return false;
  }
  rmSync(claim.ownerPath, { force: true });
  // rmdir, never a recursive remove: if anything unexpected is inside the claim
  // this fails loudly instead of deleting it.
  rmdirSync(claim.claimPath);
  return true;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

// Compare resolved paths: an invocation through a symlinked prefix (macOS
// /tmp -> /private/tmp, a symlinked checkout) is still this file being run
// directly, and importing it from a test must never start Next.
function isEntrypoint() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(process.argv[1]) === realpathSync(self);
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(self);
  }
}

async function main() {
  const isolated = inspectCsfIsolatedWorkDir(process.env.CSF_ISOLATED_WORK_DIR);
  const appEnv = loadCsfIsolatedAppEnvironment(process.env.CSF_ISOLATED_WORK_DIR);

  const serverMode = process.env.CSF_BROWSER_SERVER_MODE ?? "development";
  if (serverMode !== "development" && serverMode !== "production") {
    throw new Error(`Unknown isolated browser server mode: ${serverMode}`);
  }
  const next =
    serverMode === "production"
      ? resolveNextProductionCommands(APP_PORT, REPO_ROOT)
      : { start: resolveNextDevCommand(APP_PORT, REPO_ROOT) };
  const envFileKeys = discoverRepositoryEnvFileKeys(REPO_ROOT);
  const ledgerPath = path.join(isolated.workDir, "isolated-app-egress-ledger.jsonl");
  writeFileSync(ledgerPath, "", { mode: 0o600 });

  const { childEnv, shadowedEnvFileKeys } = buildIsolatedChildEnvironment({
    mode: "isolated-app",
    appEnv,
    isolated,
    port: APP_PORT,
    ledgerPath,
    envFileKeys,
    serverMode,
  });

  // Free before the claim, so an occupied port never even takes one.
  await assertPortFree(APP_PORT);
  const claim = claimAppPort();

  let child = null;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseAppPort(claim);
  };

  try {
    // And free again after the claim: a server that appeared in between must
    // start nothing, and must give back only the claim this process took.
    await assertPortFree(APP_PORT);
  } catch (error) {
    release();
    throw error;
  }

  console.log("DVHS CSF isolated app runner");
  console.log(`  isolated project : ${isolated.projectId}`);
  console.log(`  supabase api     : 127.0.0.1:${isolated.apiPort}`);
  console.log(`  mailpit smtp     : 127.0.0.1:${isolated.smtpPort} (local mail only)`);
  console.log(`  app              : http://127.0.0.1:${APP_PORT} (owned claim ${claim.claimPath})`);
  console.log(`  child env keys   : ${Object.keys(childEnv).length}`);
  console.log(`  .env* keys shadowed: ${shadowedEnvFileKeys.length}`);
  console.log(`  egress ledger    : ${ledgerPath}`);

  if ("build" in next) {
    console.log("  browser runtime  : production build");
    const build = spawnSync(next.build.command, next.build.args, {
      cwd: REPO_ROOT,
      env: childEnv,
      stdio: "inherit",
    });
    if (build.error) throw build.error;
    if (build.status !== 0) {
      release();
      throw new Error(`The isolated Next production build exited with code ${build.status}.`);
    }
  } else {
    console.log("  browser runtime  : development server");
  }

  child = spawn(next.start.command, next.start.args, {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: ["ignore", "inherit", "inherit"],
    // Its own process group, so termination reaches every descendant Next spawns
    // rather than orphaning them onto the claimed port.
    detached: true,
  });

  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  const forward = (signal) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };

  const signalHandlers = new Map();
  let forcedShutdown = null;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      forward(signal);
      // A Next development child that is stuck during compiler teardown must
      // not keep Playwright's owned web-server plugin alive indefinitely. The
      // child has five seconds to exit cleanly before this runner terminates
      // only its own detached process group.
      if (!forcedShutdown) {
        forcedShutdown = setTimeout(() => forward("SIGKILL"), 5_000);
        forcedShutdown.unref();
      }
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  // Wait for the whole group to be gone before the claim goes back: releasing
  // first would let a peer take a port this runner is still vacating.
  const { code, signal } = await exited;
  if (forcedShutdown) clearTimeout(forcedShutdown);
  for (const [registeredSignal, handler] of signalHandlers) {
    process.removeListener(registeredSignal, handler);
  }
  release();
  process.exitCode = signal ? 1 : (code ?? 1);
}

if (isEntrypoint()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
