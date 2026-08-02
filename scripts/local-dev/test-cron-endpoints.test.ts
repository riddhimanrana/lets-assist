import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertPortFree,
  buildChildEnvironment,
  groupAlive,
  terminateOwnedServer,
} from "./test-cron-endpoints";
import {
  buildIsolatedChildEnvironment,
  DISABLED_PROVIDER_ENV_KEYS,
  DISABLED_WORKER_ENV_KEYS,
} from "./run-dvhs-csf-isolated-app.mjs";

/**
 * Contracts for the cron auth/shape harness itself.
 *
 * Nothing here starts Next. The three things this file has to prove are the
 * three the harness cannot prove about itself at runtime:
 *
 *   1. it refuses an occupied port rather than adopting whatever answers on it;
 *   2. it terminates the whole process group, not just the direct child;
 *   3. its child environment is a positive allowlist, so a provider key in the
 *      operator's shell is absent because it was never copied.
 *
 * The egress guard is exercised for real in a child node process, because a
 * grep for "the guard exists" is not a guard.
 */

const repositoryRoot = process.cwd();
const harnessPath = join(repositoryRoot, "scripts/local-dev/test-cron-endpoints.ts");
const guardPath = join(repositoryRoot, "scripts/local-dev/cron-egress-guard.cjs");
const harnessSource = readFileSync(harnessPath, "utf8");

const temporaryDirectories: string[] = [];

function scratchDirectory(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function resolveNodeExecutable() {
  const resolved = Bun.which("node");
  if (!resolved) throw new Error("a real node executable is required for these tests");
  return resolved;
}

// ---------------------------------------------------------------------------
// A complete, valid generated isolated stack — marker, config, and app env —
// so the harness gets past its own validation and reaches the port claim.
// ---------------------------------------------------------------------------

const BASE_PORT = 55320;
const PORT_OFFSETS = [0, 1, 2, 3, 4, 5, 6, 7, 9];

function createValidatedStack() {
  const directory = scratchDirectory("csf-cron-stack-");
  chmodSync(directory, 0o700);
  mkdirSync(join(directory, "supabase"), { mode: 0o700 });
  const projectId = "lets-assist-csf-browser-cron-test";
  const [shadow, api, database, studio, inbucket, smtp, inspector, analytics, pooler] =
    PORT_OFFSETS.map((offset) => BASE_PORT + offset);

  const config = [
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
  ].join("\n");
  writeFileSync(join(directory, "supabase", "config.toml"), config, { mode: 0o600 });

  const marker = [
    "state=ready",
    `project_id=${projectId}`,
    `base_port=${BASE_PORT}`,
    `work_dir=${directory}`,
    `db_volume=supabase_db_${projectId}`,
    `db_volume_project_label=${projectId}`,
    "",
  ].join("\n");
  writeFileSync(join(directory, ".lets-assist-csf-isolated-stack"), marker, { mode: 0o600 });

  const appEnv: Record<string, string> = {
    API_URL: `http://127.0.0.1:${api}`,
    ANON_KEY: "fake-anon-token",
    SERVICE_ROLE_KEY: "fake-service-role-token",
    DB_URL: `postgresql://postgres:fake-password@127.0.0.1:${database}/postgres`,
    SUPABASE_URL: `http://127.0.0.1:${api}`,
    SUPABASE_ANON_KEY: "fake-anon-token",
    SUPABASE_DB_URL: `postgresql://postgres:fake-password@127.0.0.1:${database}/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${api}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake-generated-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-token",
    SUPABASE_SECRET_KEY: "sb_secret_fake-generated-key",
    SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-token",
    CSF_PROFILE_CLAIM_SECRET: "a".repeat(64),
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    SITE_URL: "http://localhost:3000",
    NEXT_PUBLIC_VERCEL_URL: "localhost:3000",
    CSF_ISOLATED_WORK_DIR: directory,
  };
  writeFileSync(
    join(directory, "lets-assist-browser.sh"),
    `${Object.entries(appEnv)
      .map(([key, value]) => `export ${key}='${value}'`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );

  return {
    directory,
    projectId,
    appEnv,
    isolated: {
      basePort: BASE_PORT,
      apiPort: api,
      databasePort: database,
      smtpPort: smtp,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Occupied-port refusal
// ---------------------------------------------------------------------------

describe("the harness owns its server and refuses an occupied port", () => {
  const occupied: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(occupied.splice(0).map((close) => close()));
  });

  function occupyPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "string" || address === null) {
          reject(new Error("could not determine the occupied port"));
          return;
        }
        occupied.push(
          () => new Promise<void>((done) => server.close(() => done())),
        );
        resolve(address.port);
      });
    });
  }

  test("assertPortFree rejects a port something else is already listening on", async () => {
    const port = await occupyPort();
    await expect(assertPortFree(port)).rejects.toThrow(
      /Refusing to adopt a server already listening on 127\.0\.0\.1:/u,
    );
  });

  test("assertPortFree resolves for a genuinely free port", async () => {
    const port = await occupyPort();
    await new Promise<void>((resolve) => {
      occupied.splice(0).forEach((close) => void close().then(resolve));
    });
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });

  test("the harness refuses an occupied port and never spawns a server", async () => {
    const stack = createValidatedStack();
    const port = await occupyPort();
    const fakeBin = scratchDirectory("csf-cron-fakebin-");
    const spawnLog = join(fakeBin, "spawned.log");
    // If the harness ever reached its spawn, this fake would record it. An empty
    // log is what makes "never spawns a server" a checked fact.
    writeFileSync(
      join(fakeBin, "bun"),
      ["#!/bin/sh", `printf "%s\\n" "$*" >> "${spawnLog}"`, "exit 0", ""].join("\n"),
      { mode: 0o700 },
    );

    const result = Bun.spawnSync([Bun.which("bun") ?? "bun", harnessPath], {
      cwd: repositoryRoot,
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        HOME: process.env.HOME ?? tmpdir(),
        CSF_ISOLATED_WORK_DIR: stack.directory,
        CRON_PROBE_HARNESS_PORT: String(port),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    expect(result.exitCode).not.toBe(0);
    expect(output).toContain("Refusing to adopt a server already listening on 127.0.0.1:");
    expect(existsSync(spawnLog)).toBe(false);
  }, 60_000);

  test("the harness refuses to run at all without a validated isolated work directory", async () => {
    const result = Bun.spawnSync([Bun.which("bun") ?? "bun", harnessPath], {
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? tmpdir(),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    expect(result.exitCode).not.toBe(0);
    expect(output).toContain("CSF_ISOLATED_WORK_DIR");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 2. Process-group teardown
// ---------------------------------------------------------------------------

describe("owned servers are terminated as a whole process group", () => {
  test("a detached child and its grandchild are both proven gone", async () => {
    const scratch = scratchDirectory("csf-cron-group-");
    const grandchildMarker = join(scratch, "grandchild.pid");
    const script = join(scratch, "tree.sh");
    // A parent that ignores SIGTERM plus a grandchild it never forwards signals
    // to: killing only the direct child would leave the grandchild running, so
    // this is the exact shape the group teardown has to survive.
    writeFileSync(
      script,
      [
        "#!/bin/sh",
        "trap '' TERM",
        `sh -c 'echo $$ > "${grandchildMarker}"; while true; do sleep 1; done' &`,
        "while true; do sleep 1; done",
        "",
      ].join("\n"),
      { mode: 0o700 },
    );

    const child = spawn("/bin/sh", [script], { detached: true, stdio: "ignore" });
    const pid = child.pid!;
    for (let attempt = 0; attempt < 100 && !existsSync(grandchildMarker); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const grandchildPid = Number(readFileSync(grandchildMarker, "utf8").trim());

    expect(groupAlive(pid)).toBe(true);
    expect(Number.isInteger(grandchildPid)).toBe(true);

    await terminateOwnedServer("group test", { child, baseUrl: "" });

    expect(groupAlive(pid)).toBe(false);
    // The grandchild has to be gone by name, not merely by group membership.
    let grandchildAlive = true;
    try {
      process.kill(grandchildPid, 0);
    } catch (error) {
      grandchildAlive = (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
    expect(grandchildAlive).toBe(false);
  }, 60_000);

  test("teardown is idempotent and does not throw once the group is gone", async () => {
    const child = spawn("/bin/sh", ["-c", "exit 0"], { detached: true, stdio: "ignore" });
    await new Promise((resolve) => child.once("exit", resolve));
    await expect(terminateOwnedServer("already gone", { child, baseUrl: "" })).resolves
      .toBeUndefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 3. Positive child-environment construction
// ---------------------------------------------------------------------------

describe("the child environment is a positive allowlist", () => {
  const stack = createValidatedStack();

  function build(overrides: Parameters<typeof buildChildEnvironment>[0] | null = null) {
    return buildChildEnvironment(
      overrides ?? {
        appEnv: stack.appEnv,
        isolated: stack.isolated,
        port: 3009,
        secret: "run-scoped-synthetic-secret",
        ledgerPath: join(stack.directory, "ledger.jsonl"),
        envFileKeys: [],
      },
    );
  }

  test("carries exactly the allowlisted keys and nothing else", () => {
    const childEnv = build();
    const expected = new Set([
      // OS/runtime, only those actually present in this process
      ...["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "USER", "SHELL", "TERM"].filter(
        (key) => typeof process.env[key] === "string" && process.env[key] !== "",
      ),
      // validated isolated app environment
      ...Object.keys(stack.appEnv),
      // synthetic cron tokens
      "CRON_TOKEN",
      "CRON_SECRET",
      "AUTO_PUBLISH_SECRET_TOKEN",
      "PROJECT_CANCELLATION_WORKER_SECRET_TOKEN",
      "ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN",
      "ORG_SHEET_SYNC_WORKER_SECRET_TOKEN",
      "CSF_COMMUNICATIONS_WORKER_SECRET_TOKEN",
      // false worker flags, including the CSF communications worker
      ...DISABLED_WORKER_ENV_KEYS,
      // provider and hosted-runtime keys, shadowed to empty
      ...DISABLED_PROVIDER_ENV_KEYS,
      // generated local-safe values
      "EMAIL_TRANSPORT",
      "EMAIL_FROM",
      "MAILPIT_HOST",
      "MAILPIT_SMTP_PORT",
      "MAILPIT_FROM_EMAIL",
      "TURNSTILE_BYPASS",
      "NEXT_PUBLIC_TURNSTILE_BYPASS",
      "DV_TABROOM_LIVE",
      // probe, ledger, preload, telemetry, port
      "CRON_AUTH_SHAPE_PROBE_ONLY",
      "CRON_EGRESS_LEDGER",
      "CRON_EGRESS_SMTP_PORTS",
      "NODE_OPTIONS",
      "NEXT_TELEMETRY_DISABLED",
      "PORT",
      "NODE_ENV",
    ]);

    expect(new Set(Object.keys(childEnv))).toEqual(expected);
  });

  test("the cron child refuses Mailpit while the app runner permits it", () => {
    const cronChild = build();
    // Declared as SMTP, never allowed: "the mail went to Mailpit" must not be
    // able to stand in for "no provider was contacted".
    expect(cronChild.CRON_EGRESS_SMTP_PORTS).toBe(String(stack.isolated.smtpPort));
    expect(Object.hasOwn(cronChild, "CRON_EGRESS_ALLOWED_SMTP_PORTS")).toBe(false);
    expect(Object.hasOwn(cronChild, "CRON_EGRESS_ALLOWED_LOOPBACK_PORTS")).toBe(false);

    const { childEnv: appChild } = buildIsolatedChildEnvironment({
      mode: "isolated-app",
      appEnv: stack.appEnv,
      isolated: stack.isolated,
      port: 3000,
      ledgerPath: join(stack.directory, "app-ledger.jsonl"),
      envFileKeys: [],
    });
    expect(appChild.CRON_EGRESS_ALLOWED_SMTP_PORTS).toBe(
      String(stack.isolated.smtpPort),
    );
    expect(appChild.CRON_EGRESS_ALLOWED_LOOPBACK_PORTS).toBe(
      [
        stack.isolated.apiPort,
        stack.isolated.databasePort,
        stack.isolated.smtpPort,
        3000,
      ].join(","),
    );
    // The app child is not a cron child: no probe mode, no cron tokens.
    expect(Object.hasOwn(appChild, "CRON_AUTH_SHAPE_PROBE_ONLY")).toBe(false);
    expect(Object.hasOwn(appChild, "CRON_TOKEN")).toBe(false);
  });

  test("every discovered .env* key that is not validated local-safe is shadowed", () => {
    const childEnv = build({
      appEnv: stack.appEnv,
      isolated: stack.isolated,
      port: 3009,
      secret: "run-scoped-synthetic-secret",
      ledgerPath: join(stack.directory, "ledger.jsonl"),
      envFileKeys: [
        "RESEND_API_KEY",
        "SOME_UNKNOWN_LOCAL_KEY",
        // A validated local-safe key must keep its validated value.
        "NEXT_PUBLIC_SUPABASE_URL",
      ],
    });

    expect(childEnv.RESEND_API_KEY).toBe("");
    expect(childEnv.SOME_UNKNOWN_LOCAL_KEY).toBe("");
    expect(childEnv.NEXT_PUBLIC_SUPABASE_URL).toBe(stack.appEnv.NEXT_PUBLIC_SUPABASE_URL);
  });

  test("a provider secret exported in this process is never copied into the child", () => {
    const planted = {
      RESEND_API_KEY: "re_planted_should_never_be_copied",
      GOOGLE_CLIENT_SECRET: "planted-google-secret",
      SUPABASE_ACCESS_TOKEN: "planted-supabase-access-token",
      AWS_SECRET_ACCESS_KEY: "planted-aws-secret",
    };
    for (const [key, value] of Object.entries(planted)) process.env[key] = value;
    try {
      const childEnv = build();
      const serialized = JSON.stringify(childEnv);
      for (const [key, value] of Object.entries(planted)) {
        // Never the planted value, whatever else is true of the key.
        expect(serialized, key).not.toContain(value);
        if (DISABLED_PROVIDER_ENV_KEYS.includes(key)) {
          // Explicitly shadowed to empty, so a `.env*` file cannot refill it.
          expect(childEnv[key], key).toBe("");
        } else {
          // Never copied at all — the positive allowlist simply does not carry it.
          expect(Object.hasOwn(childEnv, key), key).toBe(false);
        }
      }
    } finally {
      for (const key of Object.keys(planted)) delete process.env[key];
    }
  });

  test("every worker flag is false and the probe, ledger, preload, and telemetry are exact", () => {
    const childEnv = build();
    for (const key of [
      "AUTO_PUBLISH_ENABLED",
      "PROJECT_CANCELLATION_WORKER_ENABLED",
      "ORG_CALENDAR_SYNC_WORKER_ENABLED",
      "ORG_SHEET_SYNC_WORKER_ENABLED",
      // The one that was missing: the CSF communications worker sends mail.
      "CSF_COMMUNICATIONS_WORKER_ENABLED",
    ]) {
      expect(childEnv[key]).toBe("false");
    }
    expect(childEnv.CRON_AUTH_SHAPE_PROBE_ONLY).toBe("auth-shape-v1");
    expect(childEnv.NEXT_TELEMETRY_DISABLED).toBe("1");
    expect(childEnv.NODE_OPTIONS).toBe(`--require ${guardPath}`);
    expect(childEnv.CRON_EGRESS_SMTP_PORTS).toBe(String(BASE_PORT + 5));
    expect(childEnv.PORT).toBe("3009");
    // Stated, never inherited: a host shell exporting NODE_ENV=production must
    // not be able to reach the child.
    expect(childEnv.NODE_ENV).toBe("development");
    // Mail is explicitly local, so Resend can never be selected by fallback.
    expect(childEnv.EMAIL_TRANSPORT).toBe("mailpit");
    expect(childEnv.MAILPIT_HOST).toBe("127.0.0.1");
    expect(childEnv.MAILPIT_SMTP_PORT).toBe(String(BASE_PORT + 5));
  });

  test("the closed worker set covers every *_ENABLED flag this repository reads", async () => {
    // Rediscovered rather than restated: a new worker flag that nobody adds to
    // DISABLED_WORKER_ENV_KEYS would otherwise ship enabled into both children.
    const discovered = new Set<string>();
    const grep = Bun.spawnSync(
      [
        "grep",
        "-rhoE",
        "process\\.env\\.[A-Z][A-Z0-9_]*_ENABLED",
        join(repositoryRoot, "app"),
        join(repositoryRoot, "lib"),
        join(repositoryRoot, "services"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    for (const line of grep.stdout.toString().split("\n")) {
      const key = line.trim().replace("process.env.", "");
      if (key) discovered.add(key);
    }

    expect(discovered.size).toBeGreaterThan(0);
    for (const key of discovered) {
      expect(DISABLED_WORKER_ENV_KEYS, `${key} is not forced false`).toContain(key);
    }
  });

  test("a provider key is empty rather than absent, so @next/env cannot refill it", () => {
    const childEnv = build();
    for (const key of [
      "RESEND_API_KEY",
      "GOOGLE_CLIENT_SECRET",
      "STRIPE_SECRET_KEY",
      "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
      "TURNSTILE_SECRET_KEY",
      "NEXT_PUBLIC_REMOTE_SUPABASE_URL",
      "VERCEL",
      "VERCEL_ENV",
    ]) {
      expect(Object.hasOwn(childEnv, key), key).toBe(true);
      expect(childEnv[key], key).toBe("");
    }
  });

  test("the cron secret is one run-scoped synthetic value across every token key", () => {
    const childEnv = build();
    const tokens = [
      "CRON_TOKEN",
      "CRON_SECRET",
      "AUTO_PUBLISH_SECRET_TOKEN",
      "PROJECT_CANCELLATION_WORKER_SECRET_TOKEN",
      "ORG_CALENDAR_SYNC_WORKER_SECRET_TOKEN",
      "ORG_SHEET_SYNC_WORKER_SECRET_TOKEN",
    ].map((key) => childEnv[key]);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toBe("run-scoped-synthetic-secret");
  });

  test("the decoy identity replaces only the work directory", () => {
    const decoy = join(stack.directory, "decoy");
    const childEnv = build({
      appEnv: stack.appEnv,
      isolated: stack.isolated,
      port: 3009,
      secret: "run-scoped-synthetic-secret",
      ledgerPath: join(stack.directory, "ledger.jsonl"),
      envFileKeys: [],
      workDirOverride: decoy,
    });
    expect(childEnv.CSF_ISOLATED_WORK_DIR).toBe(decoy);
    expect(childEnv.NEXT_PUBLIC_SUPABASE_URL).toBe(stack.appEnv.NEXT_PUBLIC_SUPABASE_URL);
    expect(childEnv.SUPABASE_SERVICE_ROLE_KEY).toBe(stack.appEnv.SUPABASE_SERVICE_ROLE_KEY);
  });

  test("an incomplete validated environment is refused rather than partially copied", () => {
    const incomplete = { ...stack.appEnv };
    delete (incomplete as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY;
    expect(() =>
      buildChildEnvironment({
        appEnv: incomplete,
        isolated: stack.isolated,
        port: 3009,
        secret: "s",
        ledgerPath: "/tmp/ledger",
        envFileKeys: [],
      }),
    ).toThrow(/missing SUPABASE_SERVICE_ROLE_KEY/u);
  });
});

// ---------------------------------------------------------------------------
// 4. The egress guard, executed rather than grepped
// ---------------------------------------------------------------------------

describe("the run-scoped egress guard rejects and records", () => {
  function runGuarded(body: string, extraEnv: Record<string, string> = {}) {
    const scratch = scratchDirectory("csf-cron-egress-");
    const ledger = join(scratch, "ledger.jsonl");
    const result = Bun.spawnSync(
      [resolveNodeExecutable(), "--require", guardPath, "-e", body],
      {
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: process.env.HOME ?? tmpdir(),
          CRON_EGRESS_LEDGER: ledger,
          ...extraEnv,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const entries = existsSync(ledger)
      ? readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [];
    return {
      exitCode: result.exitCode,
      output: `${result.stdout.toString()}\n${result.stderr.toString()}`,
      entries,
    };
  }

  test("refuses to load at all without a run-scoped ledger", () => {
    const result = Bun.spawnSync([resolveNodeExecutable(), "--require", guardPath, "-e", ""], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? tmpdir() },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("refusing to run unguarded");
  });

  test("a non-loopback https request throws and is recorded", () => {
    const result = runGuarded(`
      const https = require("node:https");
      try { https.request("https://api.resend.com/emails"); console.log("NOT_BLOCKED"); }
      catch (error) { console.log("BLOCKED:" + error.message); }
    `);
    expect(result.output).toContain("BLOCKED:");
    expect(result.output).not.toContain("NOT_BLOCKED");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]).toMatchObject({ kind: "https", target: "https://api.resend.com" });
  });

  test("a non-loopback fetch rejects and is recorded", () => {
    const result = runGuarded(`
      globalThis.fetch("https://www.googleapis.com/oauth2/v4/token")
        .then(() => console.log("NOT_BLOCKED"))
        .catch((error) => console.log("BLOCKED:" + error.message));
    `);
    expect(result.output).toContain("BLOCKED:");
    expect(result.output).not.toContain("NOT_BLOCKED");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]).toMatchObject({ kind: "fetch" });
  });

  test("a well-known SMTP submission connection throws and is recorded", () => {
    const result = runGuarded(`
      const net = require("node:net");
      try { net.connect(587, "smtp.example.com"); console.log("NOT_BLOCKED"); }
      catch (error) { console.log("BLOCKED:" + error.message); }
    `);
    expect(result.output).toContain("BLOCKED:");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe("smtp");
  });

  test("loopback Mailpit SMTP is blocked too, so a local inbox is never the safety proof", () => {
    const result = runGuarded(
      `
      const net = require("node:net");
      try { net.connect(55325, "127.0.0.1"); console.log("NOT_BLOCKED"); }
      catch (error) { console.log("BLOCKED:" + error.message); }
    `,
      { CRON_EGRESS_SMTP_PORTS: "55325" },
    );
    expect(result.output).toContain("BLOCKED:");
    expect(result.output).not.toContain("NOT_BLOCKED");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]).toMatchObject({ kind: "smtp", target: "127.0.0.1:55325" });
  });

  test("ordinary loopback traffic is allowed and records nothing", () => {
    const result = runGuarded(`
      const http = require("node:http");
      const request = http.request({ host: "127.0.0.1", port: 55321, path: "/" });
      request.on("error", () => { console.log("ALLOWED"); });
      request.end();
    `);
    expect(result.output).toContain("ALLOWED");
    expect(result.entries.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // The generalized contract: the app runner permits its own validated Mailpit
  // and nothing else on loopback; the cron harness permits no SMTP at all.
  // -------------------------------------------------------------------------

  test("the app runner's own validated Mailpit port is permitted", () => {
    const result = runGuarded(
      `
      const net = require("node:net");
      try {
        const socket = net.connect(55325, "127.0.0.1");
        socket.on("error", () => { console.log("ALLOWED"); });
      } catch (error) { console.log("BLOCKED:" + error.message); }
    `,
      {
        CRON_EGRESS_SMTP_PORTS: "55325",
        CRON_EGRESS_ALLOWED_SMTP_PORTS: "55325",
        CRON_EGRESS_ALLOWED_LOOPBACK_PORTS: "55321,55322,55325,3000",
      },
    );
    expect(result.output).toContain("ALLOWED");
    expect(result.output).not.toContain("BLOCKED:");
    expect(result.entries.length).toBe(0);
  });

  test("an arbitrary loopback port is still refused under the runner's allowlist", () => {
    const result = runGuarded(
      `
      const net = require("node:net");
      try { net.connect(9200, "127.0.0.1"); console.log("NOT_BLOCKED"); }
      catch (error) { console.log("BLOCKED:" + error.message); }
    `,
      {
        CRON_EGRESS_SMTP_PORTS: "55325",
        CRON_EGRESS_ALLOWED_SMTP_PORTS: "55325",
        CRON_EGRESS_ALLOWED_LOOPBACK_PORTS: "55321,55322,55325,3000",
      },
    );
    expect(result.output).toContain("BLOCKED:");
    expect(result.output).not.toContain("NOT_BLOCKED");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]).toMatchObject({
      kind: "loopback-socket",
      target: "127.0.0.1:9200",
    });
  });

  test("a non-loopback raw socket is refused even under the runner's allowlist", () => {
    const result = runGuarded(
      `
      const net = require("node:net");
      try { net.connect(3000, "api.resend.com"); console.log("NOT_BLOCKED"); }
      catch (error) { console.log("BLOCKED:" + error.message); }
    `,
      { CRON_EGRESS_ALLOWED_LOOPBACK_PORTS: "55321,55322,55325,3000" },
    );
    expect(result.output).toContain("BLOCKED:");
    expect(result.output).not.toContain("NOT_BLOCKED");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe("socket");
  });

  test("permitting Mailpit does not permit a different SMTP port", () => {
    const result = runGuarded(
      `
      const net = require("node:net");
      try { net.connect(587, "127.0.0.1"); console.log("NOT_BLOCKED"); }
      catch (error) { console.log("BLOCKED:" + error.message); }
    `,
      {
        CRON_EGRESS_SMTP_PORTS: "55325",
        CRON_EGRESS_ALLOWED_SMTP_PORTS: "55325",
      },
    );
    expect(result.output).toContain("BLOCKED:");
    expect(result.entries.length).toBe(1);
    expect(result.entries[0].kind).toBe("smtp");
  });

  test("the guard's own evidence names both callers, not just the cron harness", () => {
    const guardSource = readFileSync(guardPath, "utf8");
    expect(guardSource).toContain("run-dvhs-csf-isolated-app.mjs");
    expect(guardSource).toContain("test-cron-endpoints.ts");
    expect(guardSource).toContain("an isolated DVHS CSF child must not egress");
  });
});

// ---------------------------------------------------------------------------
// 5. Source contracts the harness must not regress
// ---------------------------------------------------------------------------

describe("harness source contracts", () => {
  test("never spreads process.env into the child environment", () => {
    expect(harnessSource).not.toContain("...process.env");
  });

  test("never enables a worker flag", () => {
    for (const flag of DISABLED_WORKER_ENV_KEYS) {
      expect(harnessSource).not.toContain(`${flag}: "true"`);
      expect(harnessSource).not.toContain(`${flag}="true"`);
    }
    // The flags are set by the shared builder now, not by a second copy here.
    const runnerSource = readFileSync(
      join(repositoryRoot, "scripts/local-dev/run-dvhs-csf-isolated-app.mjs"),
      "utf8",
    );
    expect(runnerSource).toContain(
      'for (const key of DISABLED_WORKER_ENV_KEYS) childEnv[key] = "false";',
    );
  });

  test("builds its child environment through the shared builder, not a second parser", () => {
    expect(harnessSource).toContain("buildIsolatedChildEnvironment");
    expect(harnessSource).toContain('mode: "cron-probe"');
    // No second copy of the allowlists.
    expect(harnessSource).not.toContain("const OS_RUNTIME_KEYS");
    expect(harnessSource).not.toContain("const WORKER_FLAG_KEYS");
    expect(harnessSource).not.toContain("const ISOLATED_APP_ENV_KEYS");
  });

  test("starts Next through Node rather than an ambient bun run dev", () => {
    expect(harnessSource).toContain(
      'resolveNextDevCommand(port, REPO_ROOT, "turbopack")',
    );
    expect(harnessSource).not.toContain('spawn("bun"');
    expect(harnessSource).not.toContain('"run", "dev"');
  });

  test("states its exact five-route scope and names the six routes outside it", () => {
    expect(harnessSource).toContain(
      "the five selected worker routes: auto-publish-hours,",
    );
    for (const outside of [
      "ai-moderation",
      "anonymous-cleanup",
      "csf-communications-dispatch",
      "csf-proof-cleanup",
      "generate-recurring-projects",
      "waiver-cleanup",
    ]) {
      expect(harnessSource, outside).toContain(outside);
    }
  });

  test("never adopts an externally supplied base URL", () => {
    expect(harnessSource).not.toContain("CRON_TEST_BASE_URL");
    expect(harnessSource).not.toContain("EXISTING_DEV_SERVER_URL");
    expect(harnessSource).not.toContain("Using existing dev server");
  });

  test("covers all five stable route IDs on both dispatching methods", () => {
    for (const id of [
      "auto-publish-hours",
      "project-cancellations",
      "organization-calendar-sync",
      "organization-sheet-sync",
      "data-exports",
    ]) {
      expect(harnessSource).toContain(`id: "${id}"`);
    }
    expect(harnessSource).toContain('const METHODS = ["GET", "POST"] as const;');
  });

  test("asserts every status in the contract, including the exact bodies", () => {
    for (const status of ["401", "428", "503", "200"]) {
      expect(harnessSource).toContain(status);
    }
    expect(harnessSource).toContain("cron_probe_required");
    expect(harnessSource).toContain("cron_probe_isolation_invalid");
    expect(harnessSource).toContain('"ok,route,mode,dispatched"');
  });

  test("asserts an empty ledger after startup and around every request", () => {
    expect(harnessSource).toContain("Server startup must produce zero refused egress attempts.");
    expect(harnessSource).toContain(
      'assertNoNewEgress(\n        ledgerPath,\n        0,\n        "Server startup must produce zero refused egress attempts.",',
    );
    expect(harnessSource).toContain("assertNoNewEgress(ledgerPath, before, label)");
    expect(harnessSource).toContain("The whole run must produce zero refused egress attempts.");
  });

  test("spawns detached and terminates the whole group", () => {
    expect(harnessSource).toContain("detached: true");
    expect(harnessSource).toContain("process.kill(-pid, signal)");
    expect(harnessSource).toContain("survived teardown");
  });

  test("does not treat empty queues, credentials, Mailpit, or worker flags as the safety proof", () => {
    expect(harnessSource).toContain(
      "none of them are used as safety evidence here",
    );
    expect(harnessSource).toContain("Not proven here");
  });
});
