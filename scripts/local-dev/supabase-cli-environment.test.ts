import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { supabaseCliEnvironment } from "./supabase-cli-environment.mjs";
import {
  createSandbox,
  launch,
  launcherEnvironment,
  readCalls,
  repositoryRoot,
  resolveNodeExecutable,
} from "./csf-browser-harness.fixture";

const directories: string[] = [];
const inheritedTracing = {
  SUPABASE_TRACE_FILE: "/never-write/inherited-trace.json",
  SUPABASE_OTLP_ENDPOINT: "https://collector.invalid",
  SUPABASE_OTLP_HEADERS: "authorization=fake-test-only",
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Supabase CLI backend and tracing isolation", () => {
  test("binds local selectors without changing legitimate hosted selectors", () => {
    const environment = {
      SUPABASE_PROJECT_ID: "hosted-project",
      SUPABASE_NETWORK_ID: "foreign-network",
      SUPABASE_WORKDIR: "/foreign/config",
    };
    expect(supabaseCliEnvironment(environment)).toMatchObject(environment);
    expect(supabaseCliEnvironment(environment, "reviewed-local")).toEqual({
      SUPABASE_EXPERIMENTAL_STACK: "0",
      SUPABASE_PROJECT_ID: "reviewed-local",
      SUPABASE_NETWORK_ID: "",
    });
  });

  test.each([
    {
      selectors: ["--project-id", "foreign", "--project-id", "reviewed-local"],
      error: "does not match config.toml",
    },
    {
      selectors: ["--project-id=foreign"],
      error: "does not match config.toml",
    },
    { selectors: ["--project-id"], error: "does not match config.toml" },
    { selectors: ["--network-id=foreign"], error: "canonical project network" },
    {
      selectors: ["--workdir", ".", "--workdir", "."],
      error: "unambiguous local Supabase work directory",
    },
  ])(
    "refuses conflicting or incomplete local selectors %p before invoking CLI",
    async ({ selectors, error }) => {
      const root = await mkdtemp(join(tmpdir(), "supabase-selector-refusal-"));
      directories.push(root);
      await mkdir(join(root, "supabase"));
      await mkdir(join(root, "bin"));
      await writeFile(
        join(root, "supabase/config.toml"),
        'project_id = "reviewed-local"\n',
      );
      const cli = join(root, "bin", "supabase");
      await writeFile(cli, '#!/bin/sh\necho "CLI should not run"\nexit 0\n');
      await chmod(cli, 0o700);
      const result = Bun.spawnSync(
        [
          "/bin/bash",
          join(repositoryRoot, "scripts/local-dev/run-supabase-cli.sh"),
          "stop",
          ...selectors,
        ],
        {
          cwd: root,
          env: {
            PATH: `${join(root, "bin")}:${dirname(resolveNodeExecutable())}:/usr/bin:/bin`,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout.toString()).not.toContain("CLI should not run");
      expect(result.stderr.toString()).toContain(error);
    },
  );
  test.each([undefined, "", "0", "1", "invalid"])(
    "sanitizes the JS environment with inherited backend %p",
    (backend) => {
      const inherited = {
        ...inheritedTracing,
        SUPABASE_EXPERIMENTAL_STACK: backend,
        PATH: "/test/bin",
        SUPABASE_DB_PASSWORD: "fake-test-only",
        SUPABASE_ACCESS_TOKEN: "fake-test-only",
      };
      const result = supabaseCliEnvironment(inherited);
      expect(result).toEqual({
        SUPABASE_EXPERIMENTAL_STACK: "0",
        PATH: "/test/bin",
        SUPABASE_DB_PASSWORD: "fake-test-only",
        SUPABASE_ACCESS_TOKEN: "fake-test-only",
      });
      expect(inherited.SUPABASE_EXPERIMENTAL_STACK).toBe(backend);
      expect(inherited.SUPABASE_OTLP_ENDPOINT).toBe(
        inheritedTracing.SUPABASE_OTLP_ENDPOINT,
      );
    },
  );

  test.each(["", "1", "invalid"])(
    "sanitizes the shell version probe and command with inherited backend %p",
    async (backend) => {
      const root = await mkdtemp(join(tmpdir(), "supabase-cli-env-"));
      directories.push(root);
      const cli = join(root, "supabase");
      const calls = join(root, "calls");
      await mkdir(join(root, "config", "supabase"), { recursive: true });
      await writeFile(
        join(root, "config", "supabase", "config.json"),
        '{"experimental":{"stack":true}}',
      );
      await writeFile(
        join(root, "config", "supabase", "config.toml"),
        'project_id = "reviewed-local"\n[experimental]\nstack = true\n',
      );
      await writeFile(
        cli,
        `#!/bin/sh
[ "$SUPABASE_EXPERIMENTAL_STACK" = "0" ] || exit 97
[ "$SUPABASE_PROJECT_ID" = "reviewed-local" ] || exit 99
[ "$SUPABASE_NETWORK_ID" = "" ] || exit 96
[ "\${SUPABASE_TRACE_FILE+x}\${SUPABASE_OTLP_ENDPOINT+x}\${SUPABASE_OTLP_HEADERS+x}" = "" ] || exit 98
printf '%s\\n' "$*" >> "$FAKE_CALLS"
if [ "$1" = "--version" ]; then printf '2.120.0\\n'; else exit 43; fi
`,
      );
      await chmod(cli, 0o700);
      const result = Bun.spawnSync(
        [
          "/bin/bash",
          join(repositoryRoot, "scripts/local-dev/run-supabase-cli.sh"),
          "status",
          "--workdir",
          join(root, "config"),
        ],
        {
          cwd: root,
          env: {
            PATH: `${root}:${dirname(resolveNodeExecutable())}:/usr/bin:/bin`,
            FAKE_CALLS: calls,
            SUPABASE_EXPERIMENTAL_STACK: backend,
            SUPABASE_PROJECT_ID: "foreign-project",
            SUPABASE_NETWORK_ID: "foreign-network",
            SUPABASE_WORKDIR: "/foreign/config",
            ...inheritedTracing,
          },
        },
      );
      expect(result.exitCode).toBe(43);
      expect(await readFile(calls, "utf8")).toBe(
        `--version\nstatus --workdir ${join(root, "config")}\n`,
      );
    },
  );

  test.each(["ensure-supabase-gateway.mjs", "reset-supabase.mjs"])(
    "sanitizes the actual %s CLI subprocess",
    async (script) => {
      const root = await mkdtemp(join(tmpdir(), "supabase-js-env-"));
      directories.push(root);
      const scripts = join(root, "scripts", "local-dev");
      const bin = join(root, "bin");
      await mkdir(scripts, { recursive: true });
      await mkdir(bin);
      await mkdir(join(root, "supabase"));
      await writeFile(
        join(root, "supabase/config.toml"),
        'project_id = "reviewed-local"\n',
      );
      for (const file of [
        script,
        "supabase-cli-environment.mjs",
        "supabase-gateway-health-core.mjs",
        "supabase-project-id.mjs",
      ]) {
        await cp(
          join(repositoryRoot, "scripts", "local-dev", file),
          join(scripts, file),
        );
      }
      const calls = join(root, "calls");
      const cli = join(bin, "supabase");
      await writeFile(
        cli,
        `#!/bin/sh
[ "$SUPABASE_EXPERIMENTAL_STACK" = "0" ] || exit 97
[ "$SUPABASE_PROJECT_ID" = "reviewed-local" ] || exit 99
[ "$SUPABASE_NETWORK_ID" = "" ] || exit 96
[ "\${SUPABASE_TRACE_FILE+x}\${SUPABASE_OTLP_ENDPOINT+x}\${SUPABASE_OTLP_HEADERS+x}" = "" ] || exit 98
printf '%s\\n' "$*" >> "$FAKE_CALLS"
if [ "$1" = "--version" ]; then printf '2.120.0\\n'; else exit 43; fi
`,
      );
      await chmod(cli, 0o700);
      const result = Bun.spawnSync(
        [resolveNodeExecutable(), join(scripts, script)],
        {
          cwd: root,
          env: {
            PATH: `${bin}:/usr/bin:/bin`,
            FAKE_CALLS: calls,
            SUPABASE_EXPERIMENTAL_STACK: "1",
            SUPABASE_PROJECT_ID: "foreign-project",
            SUPABASE_NETWORK_ID: "foreign-network",
            SUPABASE_WORKDIR: "/foreign/config",
            ...inheritedTracing,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(await readFile(calls, "utf8")).toBe(
        script === "reset-supabase.mjs"
          ? "db reset --local --yes\n"
          : "--version\nstatus -o json\n",
      );
    },
  );

  test("start, status, and marker-bounded stop keep legacy selection under inherited overrides", async () => {
    const sandbox = await createSandbox("supabase-cli-legacy-lifecycle-");
    const workDir = sandbox.workDir("legacy");
    const overrides = {
      CSF_ISOLATED_RUN_ID: "legacy-env",
      CSF_ISOLATED_WORK_DIR: workDir,
      SUPABASE_EXPERIMENTAL_STACK: "1",
      SUPABASE_PROJECT_ID: "foreign-project",
      SUPABASE_NETWORK_ID: "foreign-network",
      SUPABASE_WORKDIR: "/foreign/config",
      ...inheritedTracing,
    };
    const start = launch(sandbox, overrides);
    expect(start.stderr).not.toContain("unsafe CLI backend");
    expect(start.stderr).not.toContain("inherited CLI tracing");
    expect(start.exitCode).toBe(0);
    const stop = Bun.spawnSync(
      [
        "/bin/bash",
        join(
          repositoryRoot,
          "scripts/local-dev/stop-dvhs-csf-isolated-stack.sh",
        ),
      ],
      {
        cwd: repositoryRoot,
        env: launcherEnvironment(sandbox, {
          ...overrides,
          SUPABASE_EXPERIMENTAL_STACK: "invalid",
        }),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(stop.exitCode).toBe(0);
    const calls = await readCalls(sandbox.supabaseCalls);
    expect(calls.some((call) => call.startsWith("start --workdir "))).toBe(
      true,
    );
    expect(calls.some((call) => call.startsWith("status --workdir "))).toBe(
      true,
    );
    expect(calls.some((call) => call.startsWith("stop --workdir "))).toBe(true);
  });

  test("all CLI workflows pin the reviewed backend and disable inherited trace exporters", async () => {
    for (const workflow of [
      "ci.yml",
      "deploy-schema.yml",
      "production-release-recovery.yml",
    ]) {
      const source = await readFile(
        join(repositoryRoot, ".github/workflows", workflow),
        "utf8",
      );
      const environment = source.slice(
        source.indexOf("\nenv:\n"),
        source.indexOf("\njobs:\n"),
      );
      expect(environment).toContain('SUPABASE_EXPERIMENTAL_STACK: "0"');
      for (const name of Object.keys(inheritedTracing))
        expect(environment).toContain(`${name}: ""`);
      const versions = [
        ...source.matchAll(
          /uses: supabase\/setup-cli@[^\n]+\n\s+with:\n\s+version: ([\d.]+)/gu,
        ),
      ];
      expect(versions.length).toBeGreaterThan(0);
      for (const version of versions) expect(version[1]).toBe("2.120.0");
    }
  });
});
