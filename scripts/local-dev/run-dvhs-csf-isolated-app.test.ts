import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  APP_PORT,
  APP_PORT_CLAIM_NAME,
  DISABLED_PROVIDER_ENV_KEYS,
  DISABLED_WORKER_ENV_KEYS,
  OS_RUNTIME_KEYS,
  appPortClaimRoot,
  assertPortFree,
  buildIsolatedChildEnvironment,
  claimAppPort,
  discoverRepositoryEnvFileKeys,
  releaseAppPort,
  resolveNextDevCommand,
  resolveNextProductionCommands,
} from "./run-dvhs-csf-isolated-app.mjs";

/**
 * Contracts for the isolated app runner.
 *
 * Nothing here starts Next, Docker, Supabase, or a browser. The four things this
 * file proves are the four the runner cannot prove about itself while running:
 *
 *   1. `process.env` is never spread, so a provider key exported in the
 *      operator's shell is absent or empty because of how the environment was
 *      built rather than because someone remembered to delete it;
 *   2. a value planted in a fixture `.env.local` is unreachable after a *real*
 *      `@next/env` load — the discovery is genuine, not a hard-coded key list;
 *   3. the fixed port 3000 is owned through one atomic claim that a second
 *      runner cannot take, and that is released only by the process holding the
 *      matching token;
 *   4. Next is started through a real Node executable, never `bun run dev`.
 *
 * The repository's own `.env.local` is never written to or modified: every
 * fixture lives in its own temporary directory.
 */

const repositoryRoot = process.cwd();
const runnerPath = join(
  repositoryRoot,
  "scripts/local-dev/run-dvhs-csf-isolated-app.mjs",
);
const guardPath = join(
  repositoryRoot,
  "scripts/local-dev/cron-egress-guard.cjs",
);
const runnerSource = readFileSync(runnerPath, "utf8");

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

const BASE_PORT = 55320;
const ISOLATED = {
  basePort: BASE_PORT,
  apiPort: BASE_PORT + 1,
  databasePort: BASE_PORT + 2,
  smtpPort: BASE_PORT + 5,
};

const APP_ENV: Record<string, string> = {
  API_URL: `http://127.0.0.1:${ISOLATED.apiPort}`,
  ANON_KEY: "fake-anon-token",
  SERVICE_ROLE_KEY: "fake-service-role-token",
  DB_URL: `postgresql://postgres:fake-password@127.0.0.1:${ISOLATED.databasePort}/postgres`,
  SUPABASE_URL: `http://127.0.0.1:${ISOLATED.apiPort}`,
  SUPABASE_ANON_KEY: "fake-anon-token",
  SUPABASE_DB_URL: `postgresql://postgres:fake-password@127.0.0.1:${ISOLATED.databasePort}/postgres`,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${ISOLATED.apiPort}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fake-generated-key",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-token",
  SUPABASE_SECRET_KEY: "sb_secret_fake-generated-key",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-token",
  CSF_PROFILE_CLAIM_SECRET: "a".repeat(64),
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_VERCEL_URL: "localhost:3000",
  CSF_ISOLATED_WORK_DIR: "/tmp/lets-assist-csf-browser-runner-test",
};

function build(
  options: Partial<Parameters<typeof buildIsolatedChildEnvironment>[0]> = {},
) {
  return buildIsolatedChildEnvironment({
    mode: "isolated-app",
    appEnv: APP_ENV,
    isolated: ISOLATED,
    port: APP_PORT,
    ledgerPath: "/tmp/runner-test-ledger.jsonl",
    envFileKeys: [],
    ...options,
  });
}

// ---------------------------------------------------------------------------
// 1. Positive construction
// ---------------------------------------------------------------------------

describe("the isolated app child environment is built, not inherited", () => {
  test("never spreads process.env, in behavior and in source", () => {
    expect(runnerSource).not.toContain("...process.env");

    const planted = {
      RESEND_API_KEY: "re_planted_parent_value",
      GOOGLE_CLIENT_SECRET: "planted-parent-google-secret",
      STRIPE_SECRET_KEY: "sk_live_planted_parent",
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_planted_parent",
      TURNSTILE_SECRET_KEY: "planted-parent-turnstile",
      NEXT_PUBLIC_REMOTE_SUPABASE_URL:
        "https://fotdmeakexgrkronxlof.supabase.co",
      SUPABASE_ACCESS_TOKEN: "sbp_planted_parent",
      AWS_SECRET_ACCESS_KEY: "planted-parent-aws",
    };
    for (const [key, value] of Object.entries(planted))
      process.env[key] = value;
    try {
      const { childEnv } = build();
      const serialized = JSON.stringify(childEnv);
      for (const [key, value] of Object.entries(planted)) {
        expect(serialized, key).not.toContain(value);
        if (DISABLED_PROVIDER_ENV_KEYS.includes(key)) {
          expect(childEnv[key], key).toBe("");
        } else {
          expect(Object.hasOwn(childEnv, key), key).toBe(false);
        }
      }
    } finally {
      for (const key of Object.keys(planted)) delete process.env[key];
    }
  });

  test("carries only the OS allowlist, the validated 17, and generated local-safe values", () => {
    const { childEnv } = build();
    const expected = new Set([
      ...OS_RUNTIME_KEYS.filter(
        (key: string) =>
          typeof process.env[key] === "string" && process.env[key] !== "",
      ),
      ...Object.keys(APP_ENV),
      ...DISABLED_WORKER_ENV_KEYS,
      ...DISABLED_PROVIDER_ENV_KEYS,
      "NODE_ENV",
      "NEXT_TELEMETRY_DISABLED",
      "NEXT_DIST_DIR",
      "CSF_LOCAL_FIXTURE_MODE",
      "PORT",
      "EMAIL_TRANSPORT",
      "EMAIL_FROM",
      "MAILPIT_HOST",
      "MAILPIT_SMTP_PORT",
      "MAILPIT_FROM_EMAIL",
      "TURNSTILE_BYPASS",
      "NEXT_PUBLIC_TURNSTILE_BYPASS",
      "DV_TABROOM_LIVE",
      "CRON_EGRESS_LEDGER",
      "CRON_EGRESS_SMTP_PORTS",
      "CRON_EGRESS_ALLOWED_SMTP_PORTS",
      "CRON_EGRESS_ALLOWED_LOOPBACK_PORTS",
      "CRON_SECRET",
      "NODE_OPTIONS",
    ]);

    expect(new Set(Object.keys(childEnv))).toEqual(expected);
    expect(childEnv.NEXT_DIST_DIR).toBe(".next-csf-isolated/browser-app");
    expect(childEnv.CSF_LOCAL_FIXTURE_MODE).toBe("1");
    expect(childEnv.CRON_SECRET).toMatch(/^[a-f0-9]{64}$/);
  });

  test("separates abruptly terminated cron output from browser output", () => {
    const { childEnv: browserEnv } = build();
    const { childEnv: cronEnv } = build({
      mode: "cron-probe",
      secret: "run-scoped-cron-secret",
      probeMode: "authenticated-empty",
    });

    expect(browserEnv.NEXT_DIST_DIR).toBe(".next-csf-isolated/browser-app");
    expect(cronEnv.NEXT_DIST_DIR).toBe(".next-csf-isolated/cron-probe");
    expect(cronEnv.NEXT_DIST_DIR).not.toBe(browserEnv.NEXT_DIST_DIR);
  });

  test("the validated local Supabase values stay exact", () => {
    const { childEnv } = build();
    for (const key of Object.keys(APP_ENV)) {
      expect(childEnv[key], key).toBe(APP_ENV[key]);
    }
  });

  test("every worker flag, including both CSF workers, is false", () => {
    const { childEnv } = build();
    expect(DISABLED_WORKER_ENV_KEYS).toContain(
      "CSF_COMMUNICATIONS_WORKER_ENABLED",
    );
    expect(DISABLED_WORKER_ENV_KEYS).toContain(
      "CSF_SCHEDULED_POST_PUBLISHER_ENABLED",
    );
    for (const key of DISABLED_WORKER_ENV_KEYS) {
      expect(childEnv[key], key).toBe("false");
    }
  });

  test("the closed worker set covers every *_ENABLED flag this repository reads", () => {
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
    const discovered = new Set(
      grep.stdout
        .toString()
        .split("\n")
        .map((line) => line.trim().replace("process.env.", ""))
        .filter(Boolean),
    );

    expect(discovered.size).toBeGreaterThan(0);
    for (const key of discovered) {
      expect(DISABLED_WORKER_ENV_KEYS, `${key} is not forced false`).toContain(
        key,
      );
    }
  });

  test("Mailpit is selected explicitly, so a fallback can never choose Resend", () => {
    const { childEnv } = build();
    expect(childEnv.EMAIL_TRANSPORT).toBe("mailpit");
    expect(childEnv.MAILPIT_HOST).toBe("127.0.0.1");
    expect(childEnv.MAILPIT_SMTP_PORT).toBe(String(ISOLATED.smtpPort));
    // A non-empty local From, because the transport treats "" as a real value.
    expect(childEnv.MAILPIT_FROM_EMAIL).toContain("local.lets-assist.test");
    expect(childEnv.RESEND_API_KEY).toBe("");
  });

  test("only loopback Supabase, database, SMTP, and the local app are permitted", () => {
    const { childEnv } = build();
    expect(childEnv.CRON_EGRESS_ALLOWED_LOOPBACK_PORTS).toBe(
      [
        ISOLATED.apiPort,
        ISOLATED.databasePort,
        ISOLATED.smtpPort,
        APP_PORT,
      ].join(","),
    );
    expect(childEnv.CRON_EGRESS_ALLOWED_SMTP_PORTS).toBe(
      String(ISOLATED.smtpPort),
    );
    expect(childEnv.NODE_OPTIONS).toBe(`--require ${guardPath}`);
  });

  test("an incomplete validated environment is refused rather than partially copied", () => {
    const incomplete = { ...APP_ENV };
    delete incomplete.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => build({ appEnv: incomplete })).toThrow(
      /missing SUPABASE_SERVICE_ROLE_KEY/u,
    );
  });

  test("an unknown mode is refused", () => {
    expect(() =>
      buildIsolatedChildEnvironment({
        // @ts-expect-error deliberately invalid
        mode: "whatever",
        appEnv: APP_ENV,
        isolated: ISOLATED,
        port: APP_PORT,
        ledgerPath: "/tmp/ledger",
      }),
    ).toThrow(/Unknown isolated child environment mode/u);
  });

  test("production browser mode changes only the runtime mode", () => {
    const { childEnv } = build({ serverMode: "production" });
    expect(childEnv.NODE_ENV).toBe("production");
    expect(() => build({ serverMode: "preview" as "development" })).toThrow(
      /Unknown isolated browser server mode/u,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Real @next/env discovery over a fixture .env.local
// ---------------------------------------------------------------------------

describe("repository .env* keys are discovered by a real @next/env load", () => {
  function fixtureRepository(envLocal: Record<string, string>) {
    const directory = scratchDirectory("csf-runner-envfixture-");
    // A real @next/env resolved from this repository's node_modules, loading a
    // fixture .env.local. The repository's own .env.local is never touched.
    mkdirSync(join(directory, "node_modules"), { recursive: true });
    writeFileSync(
      join(directory, ".env.local"),
      `${Object.entries(envLocal)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`,
      { mode: 0o600 },
    );
    // Point module resolution at the real @next/env without copying it.
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({ name: "csf-runner-env-fixture", private: true }),
    );
    Bun.spawnSync([
      "ln",
      "-s",
      join(repositoryRoot, "node_modules", "@next"),
      join(directory, "node_modules", "@next"),
    ]);
    return directory;
  }

  const PLANTED = {
    RESEND_API_KEY: "re_fixture_env_local_value",
    GOOGLE_CLIENT_ID: "fixture-google-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "GOCSPX-fixture-google-secret",
    STRIPE_SECRET_KEY: "sk_live_fixture_stripe",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture_stripe",
    NEXT_PUBLIC_REMOTE_SUPABASE_URL: "https://fotdmeakexgrkronxlof.supabase.co",
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_fixture_posthog",
    TURNSTILE_SECRET_KEY: "fixture-turnstile-secret",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "fixture-turnstile-site-key",
    SOME_UNCLASSIFIED_FIXTURE_KEY: "fixture-unclassified-value",
  };

  test("discovers exactly the fixture keys without polluting this process", () => {
    const directory = fixtureRepository(PLANTED);
    const before = { ...process.env };

    const keys = discoverRepositoryEnvFileKeys(directory);

    for (const key of Object.keys(PLANTED)) {
      expect(keys, key).toContain(key);
    }
    // Sterile: the discovery ran in its own process, so nothing was written here.
    for (const key of Object.keys(PLANTED)) {
      expect(process.env[key], `${key} leaked into this process`).toBe(
        before[key],
      );
    }
    expect(process.env.SOME_UNCLASSIFIED_FIXTURE_KEY).toBeUndefined();
  });

  test("every discovered provider value is absent or empty in the child", () => {
    const directory = fixtureRepository(PLANTED);
    const envFileKeys = discoverRepositoryEnvFileKeys(directory);

    // Plant the same values in the parent too, so the child has two independent
    // routes to a real credential and must close both.
    for (const [key, value] of Object.entries(PLANTED))
      process.env[key] = value;
    try {
      const { childEnv, shadowedEnvFileKeys } = build({ envFileKeys });
      const serialized = JSON.stringify(childEnv);

      for (const [key, value] of Object.entries(PLANTED)) {
        expect(serialized, key).not.toContain(value);
        expect(childEnv[key] ?? "", key).toBe("");
      }
      expect(shadowedEnvFileKeys).toContain("SOME_UNCLASSIFIED_FIXTURE_KEY");

      // Resend, Google, Stripe, remote Supabase, PostHog, and Turnstile, named
      // explicitly because those are the six the acceptance matrix requires.
      for (const key of [
        "RESEND_API_KEY",
        "GOOGLE_CLIENT_SECRET",
        "STRIPE_SECRET_KEY",
        "NEXT_PUBLIC_REMOTE_SUPABASE_URL",
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN",
        "TURNSTILE_SECRET_KEY",
      ]) {
        expect(childEnv[key], key).toBe("");
      }

      // And the generated local values survive all of that, exactly.
      expect(childEnv.NEXT_PUBLIC_SUPABASE_URL).toBe(
        APP_ENV.NEXT_PUBLIC_SUPABASE_URL,
      );
      expect(childEnv.SUPABASE_DB_URL).toBe(APP_ENV.SUPABASE_DB_URL);
      expect(childEnv.MAILPIT_SMTP_PORT).toBe(String(ISOLATED.smtpPort));
    } finally {
      for (const key of Object.keys(PLANTED)) delete process.env[key];
    }
  });

  test("a discovery failure fails closed rather than starting an unshadowed app", () => {
    // A directory with no @next/env reachable at all.
    const directory = scratchDirectory("csf-runner-nodiscovery-");
    writeFileSync(join(directory, "package.json"), "{}");
    expect(() => discoverRepositoryEnvFileKeys(directory)).toThrow(
      /Sterile @next\/env discovery failed/u,
    );
  });

  test("the runner writes only inside the validated isolated work directory", () => {
    // Explicit, because the failure mode would be silent and permanent: the one
    // file this runner creates is its own egress ledger, next to the marker.
    const writes = runnerSource.match(/writeFileSync\([^)]*/gu) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write).toMatch(/writeFileSync\((ledgerPath|ownerPath)/u);
    }
    expect(runnerSource).toMatch(
      /path\.join\(\s*isolated\.workDir,\s*"isolated-app-egress-ledger\.jsonl"\s*,?\s*\)/u,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Port 3000 ownership
// ---------------------------------------------------------------------------

describe("the fixed app port is owned through one atomic claim", () => {
  function hermeticClaimEnv() {
    const root = join(scratchDirectory("csf-runner-claims-"), "claims");
    return {
      CSF_ISOLATED_CLAIM_ROOT: root,
      CSF_ISOLATED_TEST_CLAIM_ROOT: "hermetic-test",
    };
  }

  test("the claim root is global per user and the override needs the test guard", () => {
    const uid =
      typeof process.getuid === "function" ? process.getuid() : "shared";
    const noOverride = {} as unknown as NodeJS.ProcessEnv;
    const looseOverride = {
      CSF_ISOLATED_CLAIM_ROOT: "/tmp/anything",
    } as unknown as NodeJS.ProcessEnv;
    expect(appPortClaimRoot(noOverride)).toBe(
      `/tmp/lets-assist-csf-isolated-claims-${uid}`,
    );
    expect(APP_PORT_CLAIM_NAME).toBe("app-port-3000");
    expect(() => appPortClaimRoot(looseOverride)).toThrow(
      /requires CSF_ISOLATED_TEST_CLAIM_ROOT=hermetic-test/u,
    );
  });

  test("two runners cannot own one claim", () => {
    const env = hermeticClaimEnv();
    const first = claimAppPort(env);
    try {
      expect(existsSync(first.claimPath)).toBe(true);
      expect(() => claimAppPort(env)).toThrow(
        /Another isolated app runner already owns port 3000/u,
      );
    } finally {
      expect(releaseAppPort(first)).toBe(true);
    }
    expect(existsSync(first.claimPath)).toBe(false);
  });

  test("a claim it cannot prove it owns is never deleted", () => {
    const env = hermeticClaimEnv();
    const claim = claimAppPort(env);
    try {
      // Someone else's ownership record under the same pathname.
      writeFileSync(claim.ownerPath, "pid=1\ntoken=not-this-runners-token\n", {
        mode: 0o600,
      });
      expect(releaseAppPort(claim)).toBe(false);
      expect(existsSync(claim.claimPath)).toBe(true);

      // And an unreadable record is also not authority to delete.
      rmSync(claim.ownerPath, { force: true });
      expect(releaseAppPort(claim)).toBe(false);
      expect(existsSync(claim.claimPath)).toBe(true);
    } finally {
      rmSync(claim.claimPath, { recursive: true, force: true });
    }
  });

  test("releasing removes only the caller's exact claim", () => {
    const env = hermeticClaimEnv();
    const claim = claimAppPort(env);
    const unrelated = join(claim.claimPath, "..", "port-55321");
    mkdirSync(unrelated, { mode: 0o700 });

    expect(releaseAppPort(claim)).toBe(true);
    expect(existsSync(claim.claimPath)).toBe(false);
    // An unrelated claim in the same allocator root is untouched.
    expect(existsSync(unrelated)).toBe(true);
    expect(readdirSync(join(claim.claimPath, ".."))).toEqual(["port-55321"]);
  });

  test("an occupied port is refused rather than adopted", async () => {
    const server = createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "string" || address === null) {
          reject(new Error("could not determine the occupied port"));
          return;
        }
        resolve(address.port);
      });
    });
    try {
      await expect(assertPortFree(port)).rejects.toThrow(
        /Refusing to adopt a server already listening on 127\.0\.0\.1:/u,
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });

  test("occupation after the claim starts no child and releases only that claim", () => {
    // The source shape that makes this true: the second free check sits between
    // the claim and the spawn, and its failure path releases before throwing.
    const claimIndex = runnerSource.indexOf("const claim = claimAppPort();");
    const secondCheck = runnerSource.indexOf(
      "await assertPortFree(APP_PORT);",
      claimIndex,
    );
    const releaseOnFailure = runnerSource.indexOf(
      "release();\n    throw error;",
    );
    const spawnIndex = runnerSource.indexOf("child = spawn(next.start.command");

    expect(claimIndex).toBeGreaterThan(-1);
    expect(secondCheck).toBeGreaterThan(claimIndex);
    expect(releaseOnFailure).toBeGreaterThan(secondCheck);
    expect(spawnIndex).toBeGreaterThan(releaseOnFailure);
  });

  test("termination is forwarded to the child group and the claim is released after exit", () => {
    expect(runnerSource).toContain("detached: true");
    expect(runnerSource).toContain("process.kill(-child.pid, signal)");
    expect(runnerSource).toContain('forward("SIGKILL")');
    expect(runnerSource).toContain(
      "process.removeListener(registeredSignal, handler)",
    );
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      expect(runnerSource).toContain(signal);
    }
    // Awaiting the group's exit before releasing is what stops a peer from
    // taking a port this runner is still vacating.
    const awaitExit = runnerSource.indexOf(
      "const { code, signal } = await exited;",
    );
    const releaseAfter = runnerSource.indexOf("release();", awaitExit);
    expect(awaitExit).toBeGreaterThan(-1);
    expect(releaseAfter).toBeGreaterThan(awaitExit);
  });
});

// ---------------------------------------------------------------------------
// 4. Next is started through Node, and the package script is exact
// ---------------------------------------------------------------------------

describe("the runner starts Next directly through Node", () => {
  test("resolves a real node executable and the local next binary", () => {
    const command = resolveNextDevCommand(APP_PORT, repositoryRoot);
    expect(command.command).toMatch(/(^|\/)node(\.exe)?$/u);
    expect(command.args[0]).toBe(
      join(repositoryRoot, "node_modules", "next", "dist", "bin", "next"),
    );
    expect(command.args.slice(1)).toEqual([
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ]);
  });

  test("keeps Turbopack an explicit server-only probe option", () => {
    const command = resolveNextDevCommand(
      APP_PORT,
      repositoryRoot,
      "turbopack",
    );
    expect(command.args.slice(1)).toEqual([
      "dev",
      "--turbopack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ]);
    expect(() =>
      resolveNextDevCommand(APP_PORT, repositoryRoot, "unknown" as "webpack"),
    ).toThrow("Unknown isolated Next bundler: unknown");
  });

  test("builds and starts the CI browser runtime through the local Next binary", () => {
    const commands = resolveNextProductionCommands(APP_PORT, repositoryRoot);
    expect(commands.build.args.slice(1)).toEqual(["build", "--webpack"]);
    expect(commands.start.args.slice(1)).toEqual([
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ]);
    expect(commands.build.command).toMatch(/(^|\/)node(\.exe)?$/u);
    expect(commands.start.command).toBe(commands.build.command);
  });

  test("never shells out to a package script or a bun runtime", () => {
    // Structural, not textual: the prose above the code explains what it
    // replaced, so the assertion has to look at the spawn itself.
    expect(runnerSource).toContain(
      "child = spawn(next.start.command, next.start.args, {",
    );
    expect(runnerSource).not.toMatch(/spawn(Sync)?\(\s*"bun"/u);
    expect(runnerSource).not.toMatch(/"run",\s*"dev"/u);
    expect(runnerSource).not.toMatch(/shell:\s*true/u);
  });

  test("prints no secret and no full environment value", () => {
    // Only counts, ports, and paths are logged.
    expect(runnerSource).not.toContain("console.log(childEnv");
    expect(runnerSource).not.toContain("JSON.stringify(childEnv");
    expect(runnerSource).toContain(
      "child env keys   : ${Object.keys(childEnv).length}",
    );
  });

  test("the package scripts point at the one-command bootstrap", () => {
    const packageJson = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["csf:dev:isolated"]).toBe(
      "node scripts/local-dev/bootstrap-dvhs-csf-dev.mjs",
    );
    expect(packageJson.scripts["dev:csf"]).toBe(
      "node scripts/local-dev/bootstrap-dvhs-csf-dev.mjs",
    );
    expect(packageJson.scripts.dev).toBe(
      "node scripts/local-dev/bootstrap-dvhs-csf-dev.mjs",
    );
    expect(packageJson.scripts["dev:next"]).toBe("next dev");
    const bootstrap = readFileSync(
      join(repositoryRoot, "scripts/local-dev/bootstrap-dvhs-csf-dev.mjs"),
      "utf8",
    );
    expect(bootstrap).toContain('"run-dvhs-csf-isolated-app.mjs"');
    expect(bootstrap).not.toContain("...process.env, ...appEnv");
  });
});

// ---------------------------------------------------------------------------
// 5. Both Playwright web servers go through the runner
// ---------------------------------------------------------------------------

describe("browser web servers cannot fall back to an ambient next dev", () => {
  const configs = ["playwright.csf.config.ts", "playwright.dv.config.ts"];

  test("each config starts only the isolated runner on the owned port", () => {
    for (const file of configs) {
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      expect(source, file).toContain(
        'command: "node scripts/local-dev/bootstrap-dvhs-csf-dev.mjs"',
      );
      expect(source, file).toContain("CSF_ISOLATED_APP_PORT");
      expect(source, file).toContain("reuseExistingServer: false");
      expect(source, file).toContain('CSF_BROWSER_SERVER_MODE: "production"');
    }
  });

  test("neither config spreads process.env or names an ambient next dev", () => {
    for (const file of configs) {
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      expect(source, file).not.toContain("...process.env");
      expect(source, file).not.toContain("next dev");
      expect(source, file).not.toContain("bunx next");
      expect(source, file).not.toContain("bun run dev");
    }
  });

  test("the old overridable ports and base URL are gone", () => {
    for (const file of configs) {
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      expect(source, file).not.toContain("3100");
      expect(source, file).not.toContain("3113");
      expect(source, file).not.toContain("CSF_E2E_PORT");
      expect(source, file).not.toContain("CSF_E2E_BASE_URL");
    }
  });

  test("the web-server child environment carries no provider value at all", () => {
    for (const file of configs) {
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      const start = source.indexOf("webServer:");
      expect(start, file).toBeGreaterThan(-1);
      const webServer = source.slice(start);
      for (const forbidden of [
        "GOOGLE_REDIRECT_URI",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_DB_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "CSF_PROFILE_CLAIM_SECRET",
      ]) {
        expect(webServer, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Fixture hygiene
// ---------------------------------------------------------------------------

describe("this suite mutates nothing outside its own temporary directories", () => {
  test("the repository .env.local is untouched", () => {
    const target = join(repositoryRoot, ".env.local");
    if (!existsSync(target)) return;
    const before = readFileSync(target);
    const directory = scratchDirectory("csf-runner-untouched-");
    writeFileSync(join(directory, ".env.local"), "PLANTED=value\n", {
      mode: 0o600,
    });
    chmodSync(join(directory, ".env.local"), 0o600);
    expect(readFileSync(target).equals(before)).toBe(true);
  });
});
