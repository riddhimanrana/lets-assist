#!/usr/bin/env bun
/**
 * DVHS CSF cron auth/shape smoke.
 *
 * Scope: the seven selected worker routes: auto-publish-hours,
 * project-cancellations, organization-calendar-sync, organization-sheet-sync,
 * data-exports, csf-communications-dispatch, and
 * csf-scheduled-post-publisher.
 *
 * Five other cron routes exist in this repository and are deliberately outside
 * this harness: ai-moderation, anonymous-cleanup, csf-proof-cleanup,
 * generate-recurring-projects, paper-scan-cleanup, and waiver-cleanup. They are neither probed nor
 * modified here, so nothing below should be read as evidence about them.
 *
 * What this proves: each of the seven selected routes authenticates, reaches its
 * dispatch boundary, and returns *without dispatching* — and that nothing in the
 * process attempted provider egress while it did so.
 *
 * What the previous harness proved: nothing. It adopted any reachable localhost
 * server, enabled all four workers, sent authenticated operational POSTs, and
 * treated a 200 from an empty queue as a pass. Empty queues, absent credentials,
 * Mailpit, and worker flags are all properties of the environment rather than of
 * the code, so none of them are used as safety evidence here.
 *
 * Everything below is bounded to one validated CSF isolated stack:
 *
 *   - a validated CSF_ISOLATED_WORK_DIR is required before anything starts;
 *   - the harness always starts and owns its server, and refuses an occupied
 *     port rather than adopting whatever answers on it;
 *   - the child environment is built from a positive allowlist, never by
 *     spreading process.env and deleting the secrets we happened to think of;
 *   - every worker flag is false and the cron secret is run-scoped and
 *     synthetic;
 *   - a run-scoped egress ledger records every refused non-loopback HTTP(S)
 *     request and every SMTP connection, loopback Mailpit included, and the
 *     ledger is asserted empty after startup and around every single request;
 *   - the server runs in its own process group, which is terminated as a group
 *     and proven gone.
 *
 * Two sequential phases, one owned server at a time:
 *
 *   phase 1  valid isolated identity   -> 401 / 401 / 428 / 428 / 200
 *   phase 2  invalid isolated identity -> 401 / 503 / 503
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  inspectCsfIsolatedWorkDir,
  loadCsfIsolatedAppEnvironment,
} from "./dv-local-env.mjs";
import {
  buildIsolatedChildEnvironment,
  discoverRepositoryEnvFileKeys,
  resolveNextDevCommand,
} from "./run-dvhs-csf-isolated-app.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");
const EGRESS_GUARD = join(SCRIPT_DIR, "cron-egress-guard.cjs");

const PROBE_MODE = "auth-shape-v1";
const PROBE_HEADER = "x-lets-assist-cron-probe";

/**
 * The seven selected worker routes, by stable ID, asserted on the wire so a
 * handler cannot answer under a neighbour's name.
 */
const ROUTES = [
  { id: "auto-publish-hours", path: "/api/cron/auto-publish-hours" },
  { id: "project-cancellations", path: "/api/cron/project-cancellations" },
  {
    id: "organization-calendar-sync",
    path: "/api/cron/organization-calendar-sync",
  },
  { id: "organization-sheet-sync", path: "/api/cron/organization-sheet-sync" },
  { id: "data-exports", path: "/api/cron/data-exports" },
  {
    id: "csf-communications-dispatch",
    path: "/api/cron/csf-communications-dispatch",
  },
  {
    id: "csf-scheduled-post-publisher",
    path: "/api/cron/csf-scheduled-post-publisher",
  },
] as const;

const METHODS = ["GET", "POST"] as const;

let assertions = 0;

function check(condition: unknown, message: string) {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function equals(actual: unknown, expected: unknown, message: string) {
  check(
    actual === expected,
    `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Port ownership
// ---------------------------------------------------------------------------

/**
 * Refuse an occupied port instead of adopting whatever is listening on it. An
 * adopted server is a server whose environment, workers, and credentials are
 * unknown, which is precisely the class of thing this harness must never talk
 * to with a valid token.
 */
export function assertPortFree(port: number) {
  return new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `Refusing to adopt a server already listening on 127.0.0.1:${port}. ` +
                "This harness owns its server; stop the other process or set CRON_PROBE_HARNESS_PORT."
            : `Could not claim 127.0.0.1:${port}: ${error.message}`,
        ),
      );
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve());
    });
  });
}

// ---------------------------------------------------------------------------
// Egress ledger
// ---------------------------------------------------------------------------

function ledgerEntries(ledgerPath: string): string[] {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean);
}

function assertNoNewEgress(ledgerPath: string, before: number, label: string) {
  const entries = ledgerEntries(ledgerPath);
  check(
    entries.length === before,
    `${label} produced ${entries.length - before} refused egress attempt(s):\n` +
      entries.slice(before).join("\n"),
  );
  return entries.length;
}

// ---------------------------------------------------------------------------
// Child environment — positive allowlist only
// ---------------------------------------------------------------------------

/**
 * One builder, shared with the isolated app runner. The harness does not keep a
 * second parser of the same contract: the differences between the two children
 * are data (`mode: "cron-probe"` refuses Mailpit and carries the run-scoped cron
 * tokens), not a second implementation that can drift.
 *
 * Everything the shared builder guarantees applies here too: `process.env` is
 * never spread, every provider key is shadowed to empty, every worker flag —
 * including CSF_COMMUNICATIONS_WORKER_ENABLED — is false, and every key the
 * repository's `.env*` files declare is shadowed unless it is validated
 * local-safe. NODE_ENV is stated rather than inherited, so an operator shell
 * exporting `production` cannot make the probe's hosted-runtime guard see a
 * production process.
 */
export function buildChildEnvironment(options: {
  appEnv: Record<string, string>;
  isolated: {
    basePort: number;
    apiPort: number;
    databasePort: number;
    smtpPort: number;
  };
  port: number;
  secret: string;
  ledgerPath: string;
  envFileKeys?: string[];
  workDirOverride?: string;
}): Record<string, string> {
  const { childEnv } = buildIsolatedChildEnvironment({
    mode: "cron-probe",
    appEnv: options.appEnv,
    isolated: options.isolated,
    port: options.port,
    ledgerPath: options.ledgerPath,
    envFileKeys: options.envFileKeys ?? [],
    secret: options.secret,
    probeMode: PROBE_MODE,
    workDirOverride: options.workDirOverride,
  });
  return childEnv;
}

// ---------------------------------------------------------------------------
// Owned server lifecycle
// ---------------------------------------------------------------------------

type OwnedServer = { child: ChildProcess; baseUrl: string };

async function startOwnedServer(
  label: string,
  port: number,
  childEnv: Record<string, string>,
  secret: string,
): Promise<OwnedServer> {
  await assertPortFree(port);

  console.log(
    `\n=== ${label}: starting one owned server on 127.0.0.1:${port} ===`,
  );
  // Next directly through Node, never `bun run dev`: a package script adds a
  // shell that re-reads a profile and a runtime that loads `.env*` files of its
  // own, which is two more ways for a shadowed value to come back.
  // Webpack's dev hot reloader eagerly asks the public npm registry for Next's
  // dist-tags during start(). Turbopack performs that optional lookup only when
  // a browser HMR client connects; this server-only probe never creates one.
  // This prevents the framework request rather than teaching the egress guard
  // to permit or ignore it.
  const next = resolveNextDevCommand(port, REPO_ROOT, "turbopack");
  const child = spawn(next.command, next.args, {
    cwd: REPO_ROOT,
    env: childEnv as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"] as const,
    // Its own process group, so teardown can reach every descendant Next spawns.
    detached: true,
  });

  child.stdout?.on("data", (data: Buffer) => {
    const text = String(data).trim();
    if (text) console.log(`[server] ${text}`);
  });
  child.stderr?.on("data", (data: Buffer) => {
    const text = String(data).trim();
    if (text) console.error(`[server:err] ${text}`);
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  // Readiness is an *identity* check, not a liveness check: an unauthenticated
  // cron route on our own port must answer 401. A stranger would 404, and a
  // server without our run-scoped secret could never answer 200 later.
  const deadline = Date.now() + 180_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `${label}: owned server exited early with code ${child.exitCode}.`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/cron/data-exports`, {
        method: "GET",
      });
      if (response.status === 401) {
        await response.text();
        ready = true;
        break;
      }
      await response.text();
    } catch {
      // not listening yet
    }
    await wait(500);
  }
  if (!ready) {
    throw new Error(
      `${label}: owned server never answered 401 on an unauthenticated cron route.`,
    );
  }

  // Prove the running server is the one carrying our run-scoped secret before
  // any further assertion depends on it.
  const identity = await fetch(`${baseUrl}/api/cron/data-exports`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });
  await identity.text();
  check(
    identity.status !== 401,
    `${label}: owned server does not carry this run's synthetic cron secret.`,
  );

  console.log(`${label}: owned server is ready and identity-known.`);
  return { child, baseUrl };
}

/**
 * Terminate the whole process group, wait for exit, and fail if anything
 * survives. Next spawns descendants; killing only the direct child leaves a
 * server holding the port and, worse, leaves a process the harness no longer
 * accounts for.
 */
export async function terminateOwnedServer(label: string, server: OwnedServer) {
  const pid = server.child.pid;
  if (!pid) return;

  const exited = new Promise<void>((resolve) => {
    if (server.child.exitCode !== null || server.child.signalCode !== null)
      resolve();
    else server.child.once("exit", () => resolve());
  });

  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };

  signalGroup("SIGTERM");
  await Promise.race([exited, wait(15_000)]);

  if (groupAlive(pid)) {
    signalGroup("SIGKILL");
    await Promise.race([exited, wait(5_000)]);
  }

  // Give the kernel a moment to reap, then require the group to be gone.
  for (let attempt = 0; attempt < 20 && groupAlive(pid); attempt += 1) {
    await wait(100);
  }
  check(
    !groupAlive(pid),
    `${label}: owned server process group ${pid} survived teardown.`,
  );
  console.log(
    `${label}: owned server process group ${pid} terminated and proven gone.`,
  );
}

export function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// ---------------------------------------------------------------------------
// Serial request contract
// ---------------------------------------------------------------------------

type RequestOutcome = {
  status: number;
  body: string;
  contentType: string | null;
};

async function serialRequest(
  ledgerPath: string,
  baseUrl: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  label: string,
): Promise<RequestOutcome> {
  const before = ledgerEntries(ledgerPath).length;
  const response = await fetch(`${baseUrl}${path}`, { method, headers });
  const body = await response.text();
  assertNoNewEgress(ledgerPath, before, label);
  return {
    status: response.status,
    body,
    contentType: response.headers.get("content-type"),
  };
}

function probeBody(route: string) {
  return `{"ok":true,"route":"${route}","mode":"${PROBE_MODE}","dispatched":false}`;
}

function probeRequiredBody(route: string) {
  return `{"ok":false,"route":"${route}","mode":"${PROBE_MODE}","error":"cron_probe_required","dispatched":false}`;
}

function isolationInvalidBody(route: string) {
  return `{"ok":false,"route":"${route}","mode":"${PROBE_MODE}","error":"cron_probe_isolation_invalid","dispatched":false}`;
}

async function verifyValidIdentityRoute(
  ledgerPath: string,
  baseUrl: string,
  route: (typeof ROUTES)[number],
  secret: string,
  method: string,
) {
  const auth = { Authorization: `Bearer ${secret}` };
  const tag = `${method} ${route.path}`;

  const noAuth = await serialRequest(
    ledgerPath,
    baseUrl,
    route.path,
    method,
    {},
    `${tag} (no auth)`,
  );
  equals(
    noAuth.status,
    401,
    `${tag}: an unauthenticated call must take the route's real 401 path.`,
  );

  const wrongAuth = await serialRequest(
    ledgerPath,
    baseUrl,
    route.path,
    method,
    { Authorization: "Bearer not-this-runs-secret" },
    `${tag} (wrong auth)`,
  );
  equals(
    wrongAuth.status,
    401,
    `${tag}: a wrong bearer must take the route's real 401 path.`,
  );

  const missingProbe = await serialRequest(
    ledgerPath,
    baseUrl,
    route.path,
    method,
    auth,
    `${tag} (no probe header)`,
  );
  equals(
    missingProbe.status,
    428,
    `${tag}: probe mode without the probe header must fail closed with 428.`,
  );
  equals(
    missingProbe.body,
    probeRequiredBody(route.id),
    `${tag}: 428 body must be the exact probe-required shape.`,
  );

  const wrongProbe = await serialRequest(
    ledgerPath,
    baseUrl,
    route.path,
    method,
    { ...auth, [PROBE_HEADER]: "auth-shape-v0" },
    `${tag} (wrong probe header)`,
  );
  equals(
    wrongProbe.status,
    428,
    `${tag}: a wrong probe header must fail closed with 428.`,
  );
  equals(
    wrongProbe.body,
    probeRequiredBody(route.id),
    `${tag}: wrong-header 428 body must be exact.`,
  );

  const probed = await serialRequest(
    ledgerPath,
    baseUrl,
    route.path,
    method,
    { ...auth, [PROBE_HEADER]: PROBE_MODE },
    `${tag} (exact probe)`,
  );
  equals(
    probed.status,
    200,
    `${tag}: an authenticated exact probe must return 200.`,
  );
  check(
    probed.contentType?.includes("application/json"),
    `${tag}: probe response must be JSON, received ${probed.contentType}.`,
  );
  equals(
    probed.body,
    probeBody(route.id),
    `${tag}: probe body must be the exact auth-shape-v1 shape.`,
  );

  const parsed = JSON.parse(probed.body) as Record<string, unknown>;
  equals(
    parsed.route,
    route.id,
    `${tag}: probe answered under the wrong stable route ID.`,
  );
  equals(
    parsed.mode,
    PROBE_MODE,
    `${tag}: probe answered under the wrong mode.`,
  );
  equals(
    parsed.dispatched,
    false,
    `${tag}: probe must report dispatched:false.`,
  );
  equals(
    Object.keys(parsed).join(","),
    "ok,route,mode,dispatched",
    `${tag}: probe schema must be exactly ok,route,mode,dispatched.`,
  );

  console.log(
    `  ✅ ${tag}: 401 / 401 / 428 / 428 / 200 with no dispatch and no egress`,
  );
}

async function verifyInvalidIdentityRoute(
  ledgerPath: string,
  baseUrl: string,
  route: (typeof ROUTES)[number],
  secret: string,
  method: string,
) {
  const auth = { Authorization: `Bearer ${secret}` };
  const tag = `${method} ${route.path}`;

  const noAuth = await serialRequest(
    ledgerPath,
    baseUrl,
    route.path,
    method,
    {},
    `${tag} (no auth, decoy)`,
  );
  equals(
    noAuth.status,
    401,
    `${tag}: authentication must not be weakened by an invalid isolated identity.`,
  );

  for (const [label, headers] of [
    ["no probe header", auth],
    ["exact probe header", { ...auth, [PROBE_HEADER]: PROBE_MODE }],
  ] as const) {
    const response = await serialRequest(
      ledgerPath,
      baseUrl,
      route.path,
      method,
      headers,
      `${tag} (${label}, decoy)`,
    );
    equals(
      response.status,
      503,
      `${tag}: probe mode without a validated isolated identity must fail closed with 503 (${label}).`,
    );
    equals(
      response.body,
      isolationInvalidBody(route.id),
      `${tag}: 503 body must be the exact isolation-invalid shape (${label}).`,
    );
  }

  console.log(`  ✅ ${tag}: 401 / 503 / 503 with no dispatch and no egress`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // A validated isolated stack is required before anything at all starts.
  const isolated = inspectCsfIsolatedWorkDir(process.env.CSF_ISOLATED_WORK_DIR);
  const appEnv = loadCsfIsolatedAppEnvironment(
    process.env.CSF_ISOLATED_WORK_DIR,
  ) as Record<string, string>;

  const port = Number(process.env.CRON_PROBE_HARNESS_PORT ?? "3009");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(
      `CRON_PROBE_HARNESS_PORT must be an integer between 1024 and 65535, got ${port}.`,
    );
  }
  const smtpPort = isolated.smtpPort;
  const secret = `csf-cron-probe-${randomBytes(24).toString("hex")}`;
  // A real @next/env load in a sterile child, so every key this repository's
  // `.env*` files declare is known here and shadowed in both phases.
  const envFileKeys = discoverRepositoryEnvFileKeys(REPO_ROOT);

  const scratch = mkdtempSync(join(tmpdir(), "csf-cron-probe-"));
  const ledgerPath = join(scratch, "egress-ledger.jsonl");
  writeFileSync(ledgerPath, "", { mode: 0o600 });
  // A real directory with no marker in it: the isolation check fails on absent
  // evidence rather than on a forged file.
  const decoyWorkDir = join(scratch, "decoy-identity");
  mkdirSync(decoyWorkDir, { mode: 0o700 });

  // Guard this process too, sharing the same run-scoped ledger.
  process.env.CRON_EGRESS_LEDGER = ledgerPath;
  process.env.CRON_EGRESS_SMTP_PORTS = String(smtpPort);
  await import(pathToFileURL(EGRESS_GUARD).href);

  console.log("DVHS CSF cron auth/shape smoke (auth-shape-v1)");
  console.log(
    "  scope            : the seven selected worker routes: auto-publish-hours, " +
      "project-cancellations, organization-calendar-sync, organization-sheet-sync, " +
      "data-exports, csf-communications-dispatch, and csf-scheduled-post-publisher",
  );
  console.log(
    "  outside scope    : ai-moderation, anonymous-cleanup, csf-proof-cleanup, " +
      "generate-recurring-projects, paper-scan-cleanup, and waiver-cleanup",
  );
  console.log(`  isolated project : ${isolated.projectId}`);
  console.log(
    `  isolated base    : ${isolated.basePort} (Mailpit SMTP ${smtpPort}, blocked)`,
  );
  console.log(`  claimed port     : 127.0.0.1:${port} (owned, never adopted)`);
  console.log(`  .env* keys shadowed: ${envFileKeys.length}`);
  console.log(`  egress ledger    : ${ledgerPath}`);

  let failed = false;
  try {
    // -- phase 1: valid isolated identity ---------------------------------
    const validEnv = buildChildEnvironment({
      appEnv,
      isolated,
      port,
      secret,
      ledgerPath,
      envFileKeys,
    });
    // Empty rather than absent, and on purpose: `@next/env` only applies a
    // `.env*` value for a key that is `undefined`, so an explicitly empty value
    // is what makes the file's value unreachable. What must never happen is a
    // *copied* one.
    for (const key of [
      "RESEND_API_KEY",
      "GOOGLE_CLIENT_SECRET",
      "STRIPE_SECRET_KEY",
    ]) {
      equals(
        validEnv[key],
        "",
        `Child environment must shadow ${key} to empty; provider keys are never copied.`,
      );
    }
    const phaseOne = await startOwnedServer(
      "phase 1 (valid identity)",
      port,
      validEnv,
      secret,
    );
    try {
      assertNoNewEgress(
        ledgerPath,
        0,
        "Server startup must produce zero refused egress attempts.",
      );
      for (const route of ROUTES) {
        for (const method of METHODS) {
          await verifyValidIdentityRoute(
            ledgerPath,
            phaseOne.baseUrl,
            route,
            secret,
            method,
          );
        }
      }
    } finally {
      await terminateOwnedServer("phase 1 (valid identity)", phaseOne);
    }

    // -- phase 2: invalid isolated identity -------------------------------
    // A second sequential phase rather than a second concurrent server: Next
    // allows one dev server per project directory, and the real work directory
    // is never mutated to synthesize this failure.
    const decoyEnv = buildChildEnvironment({
      appEnv,
      isolated,
      port,
      secret,
      ledgerPath,
      envFileKeys,
      workDirOverride: decoyWorkDir,
    });
    const phaseTwo = await startOwnedServer(
      "phase 2 (invalid identity)",
      port,
      decoyEnv,
      secret,
    );
    try {
      for (const route of ROUTES) {
        for (const method of METHODS) {
          await verifyInvalidIdentityRoute(
            ledgerPath,
            phaseTwo.baseUrl,
            route,
            secret,
            method,
          );
        }
      }
    } finally {
      await terminateOwnedServer("phase 2 (invalid identity)", phaseTwo);
    }

    equals(
      ledgerEntries(ledgerPath).length,
      0,
      "The whole run must produce zero refused egress attempts.",
    );
  } catch (error) {
    failed = true;
    console.error(
      `\n❌ ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failed) {
    console.error("\n❌ Cron auth/shape smoke failed.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n✅ Cron auth/shape smoke passed: ${ROUTES.length} selected routes x ${METHODS.length} methods, ` +
      `${assertions} assertions, zero dispatch, zero egress.`,
  );
  console.log(
    "   Not proven here: queue behavior, provider delivery, or any operational outcome. " +
      "This gate proves only authentication and the no-dispatch shape.",
  );
  console.log(
    "   Also not covered: ai-moderation, anonymous-cleanup, csf-proof-cleanup, " +
      "generate-recurring-projects, paper-scan-cleanup, and waiver-cleanup.",
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
