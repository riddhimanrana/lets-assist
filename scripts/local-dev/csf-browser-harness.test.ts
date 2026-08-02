import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  PINNED_SUPABASE_CLI_RESOURCE_PREFIXES,
  pinnedDatabaseVolumeName,
  pinnedResourceNames,
} from "./pinned-supabase-cli-resources.fixture";

const repositoryRoot = process.cwd();
const launcherPath = join(
  repositoryRoot,
  "scripts/local-dev/start-dvhs-csf-isolated-stack.sh",
);
const generatedDirectories: string[] = [];

// Any of these appearing as its own argv token would be a mutating Docker call.
const MUTATING_DOCKER_VERBS = [
  "rm",
  "rmi",
  "prune",
  "create",
  "kill",
  "stop",
  "start",
  "run",
  "exec",
  "cp",
];

// The launcher and the loader both shell out to node, so the fake PATH must
// carry a real node. Bun's own execPath is not it.
function resolveNodeExecutable() {
  const resolved = Bun.which("node");
  if (!resolved) throw new Error("a real node executable is required for these tests");
  return resolved;
}

afterEach(async () => {
  await Promise.all(
    generatedDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

// ---------------------------------------------------------------------------
// Hermetic fakes. Nothing here may reach the real Docker or Supabase CLI: the
// sandbox installs a fake `docker`, `supabase`, and `lsof` ahead of the real
// PATH, and every launcher run asserts the fake docker is actually present.
// ---------------------------------------------------------------------------

const FAKE_SUPABASE = [
  "#!/bin/sh",
  'printf "%s\\n" "$*" >> "${FAKE_SUPABASE_CALLS:-/dev/null}"',
  'state="${FAKE_DOCKER_STATE}"',
  'workdir=""',
  'prev=""',
  'for arg in "$@"; do',
  '  if [ "$prev" = "--workdir" ]; then workdir="$arg"; fi',
  '  prev="$arg"',
  "done",
  'project_id=""',
  'api_port=""',
  'if [ -n "$workdir" ] && [ -f "$workdir/supabase/config.toml" ]; then',
  "  project_id=$(sed -n 's/^project_id = \"\\(.*\\)\"$/\\1/p' \"$workdir/supabase/config.toml\" | head -n 1)",
  "  api_port=$(awk '/^\\[api\\]/{f=1} f && /^port = /{print $3; exit}' \"$workdir/supabase/config.toml\")",
  "fi",
  'case "$1" in',
  "  --version)",
  "    printf '%s\\n' '2.111.0'",
  "    ;;",
  "  start)",
  '    if [ -n "${FAKE_SUPABASE_START_FAIL:-}" ]; then echo "fake start failure" >&2; exit 1; fi',
  '    if [ -n "${FAKE_START_WAIT_FILE:-}" ]; then',
  "      i=0",
  '      while [ ! -f "$FAKE_START_WAIT_FILE" ] && [ "$i" -lt 900 ]; do sleep 0.05; i=$((i+1)); done',
  "    fi",
  "    printf '%s\\n' 'fake-start-credential-stdout'",
  "    printf '%s\\n' 'fake-start-credential-stderr' >&2",
  "    # What a start materializes is supplied by the test from the checked-in",
  "    # pinned-CLI oracle. This fake never asks dv-local-env.mjs what exists, so",
  "    # an implementation drift cannot be mirrored here.",
  '    materialize() {',
  '      kind_file="$1"',
  '      shift',
  '      for prefix in $*; do',
  '        printf "%s%s\\t%s\\n" "$prefix" "$project_id" "$project_id" >> "${state}/${kind_file}"',
  "      done",
  "    }",
  '    if [ -n "${FAKE_POST_START_CONTAINERS:-}" ]; then',
  '      printf "%s\\n" "${FAKE_POST_START_CONTAINERS}" >> "${state}/containers"',
  "    else",
  '      materialize containers "${FAKE_DEFAULT_CONTAINER_PREFIXES:-}"',
  "    fi",
  '    if [ -n "${FAKE_POST_START_VOLUMES:-}" ]; then',
  '      printf "%s\\n" "${FAKE_POST_START_VOLUMES}" >> "${state}/volumes"',
  "    else",
  '      materialize volumes "${FAKE_DEFAULT_VOLUME_PREFIXES:-}"',
  "    fi",
  '    if [ -n "${FAKE_POST_START_NETWORKS:-}" ]; then',
  '      printf "%s\\n" "${FAKE_POST_START_NETWORKS}" >> "${state}/networks"',
  "    else",
  '      materialize networks "${FAKE_DEFAULT_NETWORK_PREFIXES:-}"',
  "    fi",
  "    :",
  "    ;;",
  "  status)",
  '    printf \'API_URL="http://127.0.0.1:%s"\\n\' "$api_port"',
  "    printf 'ANON_KEY=\"fake-anon-token\"\\n'",
  "    printf 'SERVICE_ROLE_KEY=\"fake-service-role-token\"\\n'",
  '    printf \'DB_URL="postgresql://postgres:fake-password@127.0.0.1:%s/postgres"\\n\' "$((api_port + 1))"',
  "    printf 'PUBLISHABLE_KEY=\"sb_publishable_fake-generated-key\"\\n'",
  "    printf 'SECRET_KEY=\"sb_secret_fake-generated-key\"\\n'",
  "    ;;",
  "  stop)",
  '    if [ -n "${FAKE_SUPABASE_STOP_FAIL:-}" ]; then echo "fake stop failure" >&2; exit 1; fi',
  '    if [ -n "${FAKE_STOP_LEAVES:-}" ]; then exit 0; fi',
  "    for f in containers volumes networks; do",
  '      if [ -f "${state}/${f}" ]; then',
  "        awk -F'\\t' -v p=\"$project_id\" '$2 != p && $1 !~ (\"_\" p \"$\")' \"${state}/${f}\" > \"${state}/${f}.next\"",
  '        mv "${state}/${f}.next" "${state}/${f}"',
  "      fi",
  "    done",
  "    ;;",
  "  test) exit 0 ;;",
  "  db) exit 0 ;;",
  "  *) exit 1 ;;",
  "esac",
  "",
].join("\n");

const FAKE_DOCKER = [
  "#!/bin/sh",
  'printf "%s\\n" "$*" >> "${FAKE_DOCKER_CALLS:-/dev/null}"',
  'if [ -n "${FAKE_DOCKER_ENUMERATION_FAILS:-}" ]; then',
  '  echo "fake docker enumeration failure" >&2',
  "  exit 1",
  "fi",
  'state="${FAKE_DOCKER_STATE}"',
  'resource=""',
  "inspect=0",
  'case "$1" in',
  "  ps) resource=containers ;;",
  // `docker inspect <name>` with no kind word is the container namespace.
  "  inspect)",
  "    resource=containers",
  "    inspect=1",
  "    ;;",
  "  volume)",
  "    resource=volumes",
  '    [ "$2" = "inspect" ] && inspect=1',
  "    ;;",
  "  network)",
  "    resource=networks",
  '    [ "$2" = "inspect" ] && inspect=1',
  "    ;;",
  "  *) exit 1 ;;",
  "esac",
  'label=""',
  'last=""',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    label=com.supabase.cli.project=*) label="${arg#label=com.supabase.cli.project=}" ;;',
  "  esac",
  '  last="$arg"',
  "done",
  'file="${state}/${resource}"',
  '[ -f "$file" ] || : > "$file"',
  'if [ "$inspect" = 1 ]; then',
  'if [ -n "${FAKE_DOCKER_INSPECT_FAILS:-}" ]; then',
  '  echo "fake docker inspect failure" >&2',
  "  exit 1",
  "fi",
  "  if ! awk -F'\\t' -v n=\"$last\" '$1 == n { found=1 } END { exit !found }' \"$file\"; then exit 1; fi",
  "  awk -F'\\t' -v n=\"$last\" '$1 == n { print $2; exit }' \"$file\"",
  "  exit 0",
  "fi",
  'if [ -n "$label" ]; then',
  "  awk -F'\\t' -v l=\"$label\" '$2 == l { print $1 }' \"$file\"",
  "else",
  "  awk -F'\\t' 'NF { print $1 }' \"$file\"",
  "fi",
  "",
].join("\n");

const FAKE_LSOF = ["#!/bin/sh", 'printf "%s\\n" "$*" >> "${FAKE_LSOF_CALLS:-/dev/null}"', "exit 1", ""].join("\n");

const FAKE_BUN = [
  "#!/bin/sh",
  'printf "%s\\n" "$*" >> "${FAKE_BUN_CALLS:-/dev/null}"',
  'if [ "$1" = "run" ] && [ -n "${FAKE_BUN_FAIL:-}" ] && [ "$2" = "${FAKE_BUN_FAIL}" ]; then',
  '  echo "fake bun failure for $2" >&2',
  "  exit 3",
  "fi",
  "exit 0",
  "",
].join("\n");

type Resource = { kind: "containers" | "volumes" | "networks"; name: string; label?: string };

// Every canonical name these tests use comes from the checked-in pinned-CLI
// oracle, never from the implementation under test.
function canonicalStartResources(projectId: string) {
  return {
    containers: pinnedResourceNames(projectId, "container"),
    volumes: pinnedResourceNames(projectId, "volume"),
    networks: pinnedResourceNames(projectId, "network"),
  };
}

function labelledRecords(names: string[], label: string) {
  return names.map((name) => `${name}\t${label}`).join("\n");
}

function postStartEnvironment(
  projectId: string,
  overrides: {
    volumes?: string[];
    containers?: string[];
    networks?: string[];
    databaseVolumeLabel?: string;
    omitDatabaseVolume?: boolean;
  } = {},
) {
  const canonical = canonicalStartResources(projectId);
  const databaseVolume = pinnedDatabaseVolumeName(projectId);
  const volumes = (overrides.volumes ?? canonical.volumes)
    .filter((name) => !(overrides.omitDatabaseVolume && name === databaseVolume))
    .map((name) =>
      name === databaseVolume && overrides.databaseVolumeLabel
        ? `${name}\t${overrides.databaseVolumeLabel}`
        : `${name}\t${projectId}`,
    )
    .join("\n");

  return {
    FAKE_POST_START_CONTAINERS: labelledRecords(
      overrides.containers ?? canonical.containers,
      projectId,
    ),
    FAKE_POST_START_VOLUMES: volumes,
    FAKE_POST_START_NETWORKS: labelledRecords(
      overrides.networks ?? canonical.networks,
      projectId,
    ),
  };
}

type Sandbox = {
  directory: string;
  fakeBin: string;
  dockerState: string;
  claimRoot: string;
  supabaseCalls: string;
  dockerCalls: string;
  lsofCalls: string;
  workDir: (name: string) => string;
};

async function createSandbox(prefix = "csf-isolated-"): Promise<Sandbox> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  generatedDirectories.push(directory);
  const fakeBin = join(directory, "bin");
  const dockerState = join(directory, "docker-state");
  await mkdir(fakeBin);
  await mkdir(dockerState);
  await mkdir(join(directory, "work"));

  for (const [name, body] of [
    ["supabase", FAKE_SUPABASE],
    ["docker", FAKE_DOCKER],
    ["lsof", FAKE_LSOF],
    ["bun", FAKE_BUN],
  ] as const) {
    const target = join(fakeBin, name);
    await writeFile(target, body);
    await chmod(target, 0o700);
  }
  for (const file of ["containers", "volumes", "networks"]) {
    await writeFile(join(dockerState, file), "");
  }

  // A launcher test that fell through to the real Docker CLI would be neither
  // hermetic nor safe, so prove the fake is installed before anything runs.
  if (!existsSync(join(fakeBin, "docker"))) {
    throw new Error("fake docker executable was not installed for this test");
  }

  return {
    directory,
    fakeBin,
    dockerState,
    claimRoot: join(directory, "claims"),
    supabaseCalls: join(directory, "supabase-calls.log"),
    dockerCalls: join(directory, "docker-calls.log"),
    lsofCalls: join(directory, "lsof-calls.log"),
    workDir: (name: string) => join(directory, "work", name),
  };
}

async function seedDockerState(sandbox: Sandbox, resources: Resource[]) {
  const grouped = new Map<string, string[]>();
  for (const resource of resources) {
    const lines = grouped.get(resource.kind) ?? [];
    lines.push(`${resource.name}\t${resource.label ?? ""}`);
    grouped.set(resource.kind, lines);
  }
  for (const [kind, lines] of grouped) {
    await writeFile(join(sandbox.dockerState, kind), `${lines.join("\n")}\n`);
  }
}

function launcherEnvironment(sandbox: Sandbox, overrides: Record<string, string>) {
  if (!existsSync(join(sandbox.fakeBin, "docker"))) {
    throw new Error("refusing to launch without the fake docker executable");
  }
  return {
    ...process.env,
    PATH: `${sandbox.fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    FAKE_DOCKER_STATE: sandbox.dockerState,
    FAKE_SUPABASE_CALLS: sandbox.supabaseCalls,
    FAKE_DOCKER_CALLS: sandbox.dockerCalls,
    FAKE_LSOF_CALLS: sandbox.lsofCalls,
    FAKE_DEFAULT_CONTAINER_PREFIXES:
      PINNED_SUPABASE_CLI_RESOURCE_PREFIXES.container.join(" "),
    FAKE_DEFAULT_VOLUME_PREFIXES:
      PINNED_SUPABASE_CLI_RESOURCE_PREFIXES.volume.join(" "),
    FAKE_DEFAULT_NETWORK_PREFIXES:
      PINNED_SUPABASE_CLI_RESOURCE_PREFIXES.network.join(" "),
    CSF_ISOLATED_CLAIM_ROOT: sandbox.claimRoot,
    CSF_ISOLATED_TEST_CLAIM_ROOT: "hermetic-test",
    CSF_ISOLATED_BASE_PORT: "61000",
    ...overrides,
  };
}

function launch(sandbox: Sandbox, overrides: Record<string, string>) {
  const result = Bun.spawnSync(["/bin/bash", launcherPath], {
    cwd: repositoryRoot,
    env: launcherEnvironment(sandbox, overrides),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

async function readCalls(file: string) {
  if (!existsSync(file)) return [] as string[];
  return (await readFile(file, "utf8")).split("\n").filter(Boolean);
}

async function claimEntries(sandbox: Sandbox) {
  if (!existsSync(sandbox.claimRoot)) return [] as string[];
  const { readdir } = await import("node:fs/promises");
  return (await readdir(sandbox.claimRoot)).sort();
}

describe("isolated launcher ownership contract", () => {
  test("records one ready stack, releases every claim, and never mutates Docker", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("ready");

    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "behavior-test",
      CSF_ISOLATED_WORK_DIR: workDir,
    });

    expect(result.exitCode).toBe(0);
    const marker = await readFile(join(workDir, ".lets-assist-csf-isolated-stack"), "utf8");
    expect(marker).toBe(
      [
        "state=ready",
        "project_id=lets-assist-csf-browser-behavior-test",
        "base_port=61000",
        `work_dir=${workDir}`,
        "db_volume=supabase_db_lets-assist-csf-browser-behavior-test",
        "db_volume_project_label=lets-assist-csf-browser-behavior-test",
        "",
      ].join("\n"),
    );
    expect(await claimEntries(sandbox)).toEqual([]);

    const dockerCalls = await readCalls(sandbox.dockerCalls);
    expect(dockerCalls.length).toBeGreaterThan(0);
    for (const call of dockerCalls) {
      expect(call).toMatch(
        /^(ps -a|volume ls|network ls|volume inspect|network inspect|inspect --format)/u,
      );
      // Exact argv tokens: a project ID that merely contains "stop" is not a
      // mutating verb.
      for (const token of call.split(" ")) {
        expect(MUTATING_DOCKER_VERBS).not.toContain(token);
      }
    }
  });

  test("keeps generated stack credentials out of launcher output", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("secrets");

    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "behavior-test",
      CSF_ISOLATED_WORK_DIR: workDir,
    });

    expect(result.exitCode).toBe(0);
    const publicOutput = `${result.stdout}\n${result.stderr}`;
    for (const secret of [
      "fake-start-credential",
      "fake-anon-token",
      "fake-service-role-token",
      "fake-password",
      "sb_publishable_fake-generated-key",
      "sb_secret_fake-generated-key",
    ]) {
      expect(publicOutput).not.toContain(secret);
    }

    const profileSecret = (
      await readFile(join(workDir, "csf-profile-claim-secret"), "utf8")
    ).trim();
    expect(profileSecret).toMatch(/^[a-f0-9]{64}$/u);

    const appEnvironment = await readFile(join(workDir, "lets-assist-browser.sh"), "utf8");
    expect(appEnvironment).toContain(`export CSF_PROFILE_CLAIM_SECRET='${profileSecret}'`);
    expect(appEnvironment).toContain("export NEXT_PUBLIC_SITE_URL='http://localhost:3000'");
    expect(appEnvironment).toContain("export NEXT_PUBLIC_VERCEL_URL='localhost:3000'");
    expect(await readFile(join(workDir, "supabase-start.log"), "utf8")).toContain(
      "fake-start-credential-stdout",
    );

    for (const file of [
      "supabase-browser.env",
      "lets-assist-browser.sh",
      "supabase-start.log",
      "csf-profile-claim-secret",
      ".lets-assist-csf-isolated-stack",
    ]) {
      expect((await stat(join(workDir, file))).mode & 0o777).toBe(0o600);
    }
  });

  test("generated run IDs stay inside the 1-16 character contract and stay unique", async () => {
    const sandbox = await createSandbox();
    const projectIds: string[] = [];

    for (const [index, basePort] of [61000, 61100].entries()) {
      const result = launch(sandbox, {
        CSF_ISOLATED_WORK_DIR: sandbox.workDir(`generated-${index}`),
        CSF_ISOLATED_BASE_PORT: String(basePort),
      });
      expect(result.exitCode).toBe(0);
      const projectLine = result.stdout
        .split("\n")
        .find((line) => line.startsWith("Project: "));
      projectIds.push(projectLine!.replace("Project: ", "").trim());
    }

    expect(projectIds[0]).not.toBe(projectIds[1]);
    for (const projectId of projectIds) {
      const runId = projectId.replace("lets-assist-csf-browser-", "");
      expect(runId).toMatch(/^dv[0-9a-f]{14}$/u);
      expect(runId.length).toBe(16);
      expect(projectId.length).toBeLessThanOrEqual(40);
    }
  });

  test("accepts the worst-case 16-character run ID", async () => {
    const sandbox = await createSandbox();
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "a".repeat(16),
      CSF_ISOLATED_WORK_DIR: sandbox.workDir("worst-case"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Project: lets-assist-csf-browser-${"a".repeat(16)}`);
  });

  test("requires the explicit test guard before honouring a non-global claim root", async () => {
    const sandbox = await createSandbox();
    const result = Bun.spawnSync(["/bin/bash", launcherPath], {
      cwd: repositoryRoot,
      env: {
        ...launcherEnvironment(sandbox, {
          CSF_ISOLATED_RUN_ID: "guarded",
          CSF_ISOLATED_WORK_DIR: sandbox.workDir("guarded"),
        }),
        CSF_ISOLATED_TEST_CLAIM_ROOT: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "CSF_ISOLATED_CLAIM_ROOT is a test-only override",
    );
    expect(await readCalls(sandbox.dockerCalls)).toEqual([]);
  });

  test("the default claim root is global per user rather than TMPDIR derived", () => {
    const launcher = readFileSync(launcherPath, "utf8");
    expect(launcher).toContain('CLAIM_ROOT="/tmp/lets-assist-csf-isolated-claims-$(id -u)"');
    expect(launcher).not.toMatch(/CLAIM_ROOT="\$\{TMPDIR/u);
  });
});

describe("stop path consumes the shared strict validator", () => {
  const stopPath = join(
    repositoryRoot,
    "scripts/local-dev/stop-dvhs-csf-isolated-stack.sh",
  );

  async function readyStack(sandbox: Sandbox, runId: string) {
    const workDir = sandbox.workDir(`stop-${runId}`);
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: runId,
      CSF_ISOLATED_WORK_DIR: workDir,
    });
    expect(result.exitCode).toBe(0);
    return workDir;
  }

  function stop(sandbox: Sandbox, workDir: string, extra: string[] = []) {
    const result = Bun.spawnSync(["/bin/bash", stopPath, ...extra, workDir], {
      cwd: repositoryRoot,
      env: launcherEnvironment(sandbox, {}),
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  test("stops a validated ready stack and reports its exact identity", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "stop-ok");

    const result = stop(sandbox, workDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Isolated project: lets-assist-csf-browser-stop-ok");
    expect(result.stdout).toContain("Marker state: ready");

    // The stop path enumerates all three kinds and still issues only read-only
    // Docker calls; deletion is Supabase's job, bounded by --project-id.
    const dockerCalls = await readCalls(sandbox.dockerCalls);
    expect(dockerCalls.some((call) => call.startsWith("ps -a"))).toBe(true);
    expect(dockerCalls.some((call) => call.startsWith("volume ls"))).toBe(true);
    expect(dockerCalls.some((call) => call.startsWith("network ls"))).toBe(true);
    for (const call of dockerCalls) {
      expect(call).toMatch(
        /^(ps -a|volume ls|network ls|volume inspect|network inspect|inspect --format)/u,
      );
      // Exact argv tokens: a project ID that merely contains "stop" is not a
      // mutating verb.
      for (const token of call.split(" ")) {
        expect(MUTATING_DOCKER_VERBS).not.toContain(token);
      }
    }
  }, 60_000);

  test("refuses a hardlinked marker before any stop, Docker call, or deletion", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "stop-link");
    await writeFile(sandbox.supabaseCalls, "");
    await writeFile(sandbox.dockerCalls, "");
    const { link } = await import("node:fs/promises");
    await link(
      join(workDir, ".lets-assist-csf-isolated-stack"),
      join(workDir, "marker-second-name"),
    );

    const result = stop(sandbox, workDir, ["--delete-workdir"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("failed strict validation");
    expect(existsSync(workDir)).toBe(true);
    expect((await readCalls(sandbox.supabaseCalls)).filter((call) => call.startsWith("stop "))).toEqual([]);
    expect(await readCalls(sandbox.dockerCalls)).toEqual([]);
  }, 60_000);

  test("refuses an unknown marker field and a copied marker from another stack", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "stop-unknown");
    const markerPath = join(workDir, ".lets-assist-csf-isolated-stack");
    const original = await readFile(markerPath, "utf8");
    await writeFile(markerPath, `${original}adopted=true\n`);
    await chmod(markerPath, 0o600);

    const unknownField = stop(sandbox, workDir);
    expect(unknownField.exitCode).toBe(1);
    expect(unknownField.stderr).toContain("failed strict validation");

    // A marker copied from a different stack cannot authorize this directory.
    const other = await readyStack(sandbox, "stop-other");
    await writeFile(markerPath, await readFile(
      join(other, ".lets-assist-csf-isolated-stack"),
      "utf8",
    ));
    await chmod(markerPath, 0o600);
    const copied = stop(sandbox, workDir, ["--delete-workdir"]);
    expect(copied.exitCode).toBe(1);
    expect(copied.stderr).toContain("failed strict validation");
    expect(existsSync(workDir)).toBe(true);
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Teardown must retain recovery evidence unless Docker residual proof succeeds.
//
// The defect this replaces: residual enumeration was conditional on
// `command -v docker`, so a host without Docker skipped the proof entirely and
// then deleted the work directory anyway. The case where we could prove least
// was the case where we destroyed most.
// ---------------------------------------------------------------------------
describe("teardown retains evidence unless Docker residual proof succeeds", () => {
  const stopPath = join(
    repositoryRoot,
    "scripts/local-dev/stop-dvhs-csf-isolated-stack.sh",
  );

  async function readyStack(sandbox: Sandbox, runId: string) {
    const workDir = sandbox.workDir(`proof-${runId}`);
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: runId,
      CSF_ISOLATED_WORK_DIR: workDir,
    });
    expect(result.exitCode).toBe(0);
    // Only the stop path's own calls should be judged below.
    await writeFile(sandbox.supabaseCalls, "");
    await writeFile(sandbox.dockerCalls, "");
    return workDir;
  }

  function stop(
    sandbox: Sandbox,
    workDir: string,
    extra: string[] = [],
    overrides: Record<string, string> = {},
    pathOverride?: string,
  ) {
    const result = Bun.spawnSync(["/bin/bash", stopPath, ...extra, workDir], {
      cwd: repositoryRoot,
      env: {
        ...launcherEnvironment(sandbox, overrides),
        ...(pathOverride ? { PATH: pathOverride } : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  function retainedEvidence(workDir: string) {
    return {
      workDir: existsSync(workDir),
      marker: existsSync(join(workDir, ".lets-assist-csf-isolated-stack")),
      config: existsSync(join(workDir, "supabase", "config.toml")),
      startLog: existsSync(join(workDir, "supabase-start.log")),
    };
  }

  test("a host without Docker makes zero supabase stop calls and retains everything", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "no-docker");

    // A PATH carrying the real supabase-less fake bin minus docker: the CLI the
    // proof needs is genuinely absent.
    const dockerlessBin = join(sandbox.directory, "bin-no-docker");
    await mkdir(dockerlessBin, { recursive: true });
    for (const name of ["supabase", "lsof", "bun"]) {
      await cp(join(sandbox.fakeBin, name), join(dockerlessBin, name));
      await chmod(join(dockerlessBin, name), 0o700);
    }
    // Do not put /usr/bin or /bin back on PATH: hosted Linux runners ship a
    // real Docker CLI there, which made this negative capability test depend
    // on the runner image. Copy only the ordinary tools the teardown needs.
    for (const name of [
      "cat",
      "dirname",
      "git",
      "grep",
      "head",
      "id",
      "node",
      "rm",
      "tr",
    ]) {
      const executable = Bun.which(name);
      if (!executable) throw new Error(`${name} is required for this test`);
      const target = join(dockerlessBin, name);
      await writeFile(target, `#!/bin/sh\nexec ${JSON.stringify(executable)} "$@"\n`);
      await chmod(target, 0o700);
    }

    const result = stop(
      sandbox,
      workDir,
      ["--delete-workdir"],
      {},
      dockerlessBin,
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("docker is required to prove residual state");
    expect(
      (await readCalls(sandbox.supabaseCalls)).filter((call) => call.startsWith("stop ")),
    ).toEqual([]);
    expect(retainedEvidence(workDir)).toEqual({
      workDir: true,
      marker: true,
      config: true,
      startLog: true,
    });
    expect(result.stderr).toContain("allocator recovery evidence are preserved");
  }, 90_000);

  test("a failing pre-stop enumeration makes zero supabase stop calls and retains everything", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "enum-fail");

    const result = stop(sandbox, workDir, ["--delete-workdir"], {
      FAKE_DOCKER_ENUMERATION_FAILS: "1",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "read-only Docker enumeration failed before any stop was attempted",
    );
    expect(
      (await readCalls(sandbox.supabaseCalls)).filter((call) => call.startsWith("stop ")),
    ).toEqual([]);
    expect(retainedEvidence(workDir)).toEqual({
      workDir: true,
      marker: true,
      config: true,
      startLog: true,
    });
  }, 90_000);

  test("an unexpected residual resource fails nonzero and refuses to delete the workdir", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "residual");

    const result = stop(sandbox, workDir, ["--delete-workdir"], {
      FAKE_STOP_LEAVES: "1",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("isolated resources still remain");
    expect(retainedEvidence(workDir)).toEqual({
      workDir: true,
      marker: true,
      config: true,
      startLog: true,
    });
    expect(result.stderr).toContain("Retained isolated work directory");
  }, 90_000);

  test("a completed residual proof is what authorizes --delete-workdir", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "proof-ok");

    const result = stop(sandbox, workDir, ["--delete-workdir"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Docker residual enumeration: available");
    expect(result.stdout).toContain("Docker residual proof: no container, volume, or network remains");
    expect(result.stdout).toContain("Deleted isolated work directory");
    expect(existsSync(workDir)).toBe(false);

    // Enumeration happened on both sides of the stop, and every Docker call
    // stayed read-only.
    const dockerCalls = await readCalls(sandbox.dockerCalls);
    const stopIndex = dockerCalls.length;
    expect(stopIndex).toBeGreaterThan(6);
    for (const call of dockerCalls) {
      expect(call).toMatch(
        /^(ps -a|volume ls|network ls|volume inspect|network inspect|inspect --format)/u,
      );
      for (const token of call.split(" ")) {
        expect(MUTATING_DOCKER_VERBS).not.toContain(token);
      }
    }
  }, 90_000);

  test("without --delete-workdir a successful proof still retains the directory", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "retain");

    const result = stop(sandbox, workDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Retained isolated work directory");
    expect(retainedEvidence(workDir)).toEqual({
      workDir: true,
      marker: true,
      config: true,
      startLog: true,
    });
  }, 90_000);

  test("a dry run proves Docker first, then changes nothing and never stops", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "dry-run");

    const result = stop(sandbox, workDir, ["--dry-run", "--delete-workdir"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Docker residual enumeration: available");
    expect(result.stdout).toContain(
      "Dry run: no containers, volumes, networks, or files were changed.",
    );
    expect(result.stdout).toContain("residual proof succeeded");
    expect(
      (await readCalls(sandbox.supabaseCalls)).filter((call) => call.startsWith("stop ")),
    ).toEqual([]);
    expect(existsSync(workDir)).toBe(true);
  }, 90_000);

  test("deletion authority is unreachable in source without the completed proof flag", () => {
    const stopSource = readFileSync(stopPath, "utf8");
    const proofLine = stopSource.indexOf("RESIDUAL_PROOF_COMPLETE=true");
    const deleteLine = stopSource.indexOf('rm -rf -- "${WORK_DIR}"');
    const guardLine = stopSource.indexOf('if [[ "${RESIDUAL_PROOF_COMPLETE}" != true ]]; then');

    expect(proofLine).toBeGreaterThan(-1);
    expect(guardLine).toBeGreaterThan(proofLine);
    expect(deleteLine).toBeGreaterThan(guardLine);
    // Exactly one deletion site, and it is behind the guard.
    expect(stopSource.match(/rm -rf/gu)?.length).toBe(1);
    // No globs, pruning, broad Docker deletion, or unresolved-variable deletion.
    expect(stopSource).not.toContain("docker system prune");
    expect(stopSource).not.toContain("docker volume prune");
    expect(stopSource).not.toContain("docker rm");
    expect(stopSource).not.toMatch(/rm -rf .*\*/u);
  });
});

// ---------------------------------------------------------------------------
// Pre-stop ownership validation.
//
// Enumerating resources is not the same as recognizing them. Before this wave
// the stop path enumerated a union of "carries the exact label" and "matches a
// canonical name", found it non-empty, and stopped anyway — so a foreign volume
// under a canonical name, a labeled resource under an unexpected name, and a
// canonical name in the wrong Docker kind all reached `supabase stop`.
//
// Every case below asserts the same three things about a refusal: nonzero exit,
// zero `supabase stop` calls, and the marker/config/log evidence still on disk.
// ---------------------------------------------------------------------------
describe("pre-stop validation refuses any inventory it does not exactly own", () => {
  const stopPath = join(
    repositoryRoot,
    "scripts/local-dev/stop-dvhs-csf-isolated-stack.sh",
  );

  async function readyStack(sandbox: Sandbox, runId: string) {
    const workDir = sandbox.workDir(`prestop-${runId}`);
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: runId,
      CSF_ISOLATED_WORK_DIR: workDir,
    });
    expect(result.exitCode).toBe(0);
    // Only the stop path's own calls are judged below.
    await writeFile(sandbox.supabaseCalls, "");
    await writeFile(sandbox.dockerCalls, "");
    return workDir;
  }

  function stop(
    sandbox: Sandbox,
    workDir: string,
    extra: string[] = [],
    overrides: Record<string, string> = {},
  ) {
    const result = Bun.spawnSync(["/bin/bash", stopPath, ...extra, workDir], {
      cwd: repositoryRoot,
      env: launcherEnvironment(sandbox, overrides),
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }

  function canonical(projectId: string) {
    return {
      containers: pinnedResourceNames(projectId, "container"),
      volumes: pinnedResourceNames(projectId, "volume"),
      networks: pinnedResourceNames(projectId, "network"),
      databaseVolume: pinnedDatabaseVolumeName(projectId),
    };
  }

  async function assertZeroMutation(sandbox: Sandbox, workDir: string) {
    expect(
      (await readCalls(sandbox.supabaseCalls)).filter((call) => call.startsWith("stop ")),
    ).toEqual([]);
    expect(existsSync(workDir)).toBe(true);
    expect(existsSync(join(workDir, ".lets-assist-csf-isolated-stack"))).toBe(true);
    expect(existsSync(join(workDir, "supabase", "config.toml"))).toBe(true);
    expect(existsSync(join(workDir, "supabase-start.log"))).toBe(true);
    for (const call of await readCalls(sandbox.dockerCalls)) {
      for (const token of call.split(" ")) {
        expect(MUTATING_DOCKER_VERBS).not.toContain(token);
      }
    }
  }

  async function expectRefusal(
    runId: string,
    inventory: (projectId: string) => Resource[],
    expected: string,
    overrides: Record<string, string> = {},
  ) {
    const sandbox = await createSandbox();
    const projectId = `lets-assist-csf-browser-${runId}`;
    const workDir = await readyStack(sandbox, runId);
    const resources = inventory(projectId);
    if (resources.length > 0) await seedDockerState(sandbox, resources);

    // --delete-workdir on purpose: a refusal must not merely skip the stop, it
    // must also leave deletion authority unreachable.
    const result = stop(sandbox, workDir, ["--delete-workdir"], overrides);

    expect(result.exitCode, runId).not.toBe(0);
    expect(result.stderr, runId).toContain(expected);
    await assertZeroMutation(sandbox, workDir);
  }

  test("a database volume carrying the wrong label refuses", async () => {
    await expectRefusal(
      "wronglabel",
      (projectId) => {
        const names = canonical(projectId);
        return names.volumes.map((name) => ({
          kind: "volumes" as const,
          name,
          label: name === names.databaseVolume ? "someone-elses-project" : projectId,
        }));
      },
      "is not lets-assist-csf-browser-wronglabel",
    );
  }, 90_000);

  test("a database volume with no label at all refuses", async () => {
    await expectRefusal(
      "nolabel",
      (projectId) => {
        const names = canonical(projectId);
        return names.volumes.map((name) => ({
          kind: "volumes" as const,
          name,
          label: name === names.databaseVolume ? "" : projectId,
        }));
      },
      "label '<none>' is not",
    );
  }, 90_000);

  test("a missing recorded database volume refuses", async () => {
    await expectRefusal(
      "missingvol",
      (projectId) => {
        const names = canonical(projectId);
        return names.volumes
          .filter((name) => name !== names.databaseVolume)
          .map((name) => ({ kind: "volumes" as const, name, label: projectId }));
      },
      "is not present with the exact label",
    );
  }, 90_000);

  test("an unexpected exact-labeled container refuses", async () => {
    await expectRefusal(
      "extracont",
      (projectId) => [
        ...canonical(projectId).containers.map((name) => ({
          kind: "containers" as const,
          name,
          label: projectId,
        })),
        { kind: "containers", name: "someone-elses-sidecar", label: projectId },
      ],
      "refused an unexpected container",
    );
  }, 90_000);

  test("an unexpected exact-labeled volume refuses", async () => {
    await expectRefusal(
      "extravol",
      (projectId) => [
        ...canonical(projectId).volumes.map((name) => ({
          kind: "volumes" as const,
          name,
          label: projectId,
        })),
        { kind: "volumes", name: "someone-elses-data", label: projectId },
      ],
      "refused an unexpected volume",
    );
  }, 90_000);

  test("an unexpected exact-labeled network refuses", async () => {
    await expectRefusal(
      "extranet",
      (projectId) => [
        ...canonical(projectId).networks.map((name) => ({
          kind: "networks" as const,
          name,
          label: projectId,
        })),
        { kind: "networks", name: "someone-elses-bridge", label: projectId },
      ],
      "refused an unexpected network",
    );
  }, 90_000);

  test("a canonical container name appearing in the volume kind refuses", async () => {
    // Docker namespaces names per kind, so a *volume* named like the canonical
    // Kong container is not this project's — it is a same-name collision.
    await expectRefusal(
      "crosskind",
      (projectId) => [
        ...canonical(projectId).volumes.map((name) => ({
          kind: "volumes" as const,
          name,
          label: projectId,
        })),
        {
          kind: "volumes",
          name: `supabase_kong_${projectId}`,
          label: projectId,
        },
      ],
      "refused an unexpected volume",
    );
  }, 90_000);

  test("a canonical volume name appearing in the network kind refuses", async () => {
    await expectRefusal(
      "crosskind2",
      (projectId) => [
        ...canonical(projectId).networks.map((name) => ({
          kind: "networks" as const,
          name,
          label: projectId,
        })),
        {
          kind: "networks",
          name: pinnedDatabaseVolumeName(projectId),
          label: projectId,
        },
      ],
      "refused an unexpected network",
    );
  }, 90_000);

  test("a label-inspection failure refuses rather than assuming ownership", async () => {
    await expectRefusal(
      "inspectfail",
      () => [],
      "could not inspect",
      { FAKE_DOCKER_INSPECT_FAILS: "1" },
    );
  }, 90_000);

  test("a valid ready inventory produces exactly one bounded stop", async () => {
    const sandbox = await createSandbox();
    const workDir = await readyStack(sandbox, "validready");

    const result = stop(sandbox, workDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Pre-stop ownership validation: every present resource is canonical for its kind",
    );
    const stops = (await readCalls(sandbox.supabaseCalls)).filter((call) =>
      call.startsWith("stop "),
    );
    expect(stops.length).toBe(1);
    expect(stops[0]).toContain("--project-id lets-assist-csf-browser-validready");
    expect(stops[0]).toContain("--workdir");
  }, 90_000);

  test("a valid partial starting inventory is permitted", async () => {
    const sandbox = await createSandbox();
    const projectId = "lets-assist-csf-browser-partial";
    const workDir = await readyStack(sandbox, "partial");

    // Demote the marker to the transitional state the launcher writes before it
    // knows its database volume, and leave only part of the canonical set live.
    const markerPath = join(workDir, ".lets-assist-csf-isolated-stack");
    await writeFile(
      markerPath,
      [
        "state=starting",
        `project_id=${projectId}`,
        "base_port=61000",
        `work_dir=${await realpath(workDir)}`,
        "",
      ].join("\n"),
    );
    await chmod(markerPath, 0o600);
    await seedDockerState(sandbox, [
      { kind: "containers", name: `supabase_db_${projectId}`, label: projectId },
      { kind: "volumes", name: pinnedDatabaseVolumeName(projectId), label: projectId },
      { kind: "networks", name: `supabase_network_${projectId}`, label: projectId },
    ]);

    const result = stop(sandbox, workDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Marker state: starting");
    expect(
      (await readCalls(sandbox.supabaseCalls)).filter((call) => call.startsWith("stop ")).length,
    ).toBe(1);
  }, 90_000);

  test("a starting inventory with one invalid resource is still refused", async () => {
    const sandbox = await createSandbox();
    const projectId = "lets-assist-csf-browser-partialbad";
    const workDir = await readyStack(sandbox, "partialbad");

    const markerPath = join(workDir, ".lets-assist-csf-isolated-stack");
    await writeFile(
      markerPath,
      [
        "state=starting",
        `project_id=${projectId}`,
        "base_port=61000",
        `work_dir=${await realpath(workDir)}`,
        "",
      ].join("\n"),
    );
    await chmod(markerPath, 0o600);
    await seedDockerState(sandbox, [
      { kind: "containers", name: `supabase_db_${projectId}`, label: projectId },
      { kind: "containers", name: "someone-elses-sidecar", label: projectId },
      { kind: "volumes", name: pinnedDatabaseVolumeName(projectId), label: projectId },
      { kind: "networks", name: `supabase_network_${projectId}`, label: projectId },
    ]);

    const result = stop(sandbox, workDir, ["--delete-workdir"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("refused an unexpected container");
    await assertZeroMutation(sandbox, workDir);
  }, 90_000);

  test("a dry run performs the full validation and still stops nothing", async () => {
    const valid = await createSandbox();
    const validWorkDir = await readyStack(valid, "dryok");
    const validRun = stop(valid, validWorkDir, ["--dry-run", "--delete-workdir"]);
    expect(validRun.exitCode).toBe(0);
    expect(validRun.stdout).toContain("Pre-stop ownership validation:");
    expect(
      (await readCalls(valid.supabaseCalls)).filter((call) => call.startsWith("stop ")),
    ).toEqual([]);
    expect(existsSync(validWorkDir)).toBe(true);

    const invalid = await createSandbox();
    const invalidProject = "lets-assist-csf-browser-drybad";
    const invalidWorkDir = await readyStack(invalid, "drybad");
    await seedDockerState(invalid, [
      ...pinnedResourceNames(invalidProject, "container").map((name) => ({
        kind: "containers" as const,
        name,
        label: invalidProject,
      })),
      { kind: "containers", name: "someone-elses-sidecar", label: invalidProject },
    ]);
    const invalidRun = stop(invalid, invalidWorkDir, ["--dry-run", "--delete-workdir"]);
    expect(invalidRun.exitCode).not.toBe(0);
    expect(invalidRun.stderr).toContain("refused an unexpected container");
    expect(invalidRun.stdout).not.toContain("Dry run: no containers");
    await assertZeroMutation(invalid, invalidWorkDir);
  }, 120_000);

  test("validation is source-ordered before dry-run handling and before any stop", () => {
    const stopSource = readFileSync(stopPath, "utf8");
    const validate = stopSource.indexOf('if ! validate_owned_inventory "${PRE_STOP_RESOURCES}"; then');
    const dryRun = stopSource.indexOf('if [[ "${DRY_RUN}" == true ]]; then');
    const stopCall = stopSource.indexOf("supabase stop \\");

    expect(validate).toBeGreaterThan(-1);
    expect(dryRun).toBeGreaterThan(validate);
    expect(stopCall).toBeGreaterThan(dryRun);

    // Names and labels still come from the one shared contract, and no looser
    // matching, direct removal, or recovery command was introduced.
    expect(stopSource).toContain("--canonical-docker-names");
    expect(stopSource).not.toContain("docker rm");
    expect(stopSource).not.toContain("docker volume rm");
    expect(stopSource).not.toContain("docker network rm");
    expect(stopSource).not.toContain("prune");
    expect(stopSource).not.toMatch(/grep -E .*supabase_.*\*/u);
  });
});

describe("isolated launcher Docker identity matrix", () => {
  const project = "lets-assist-csf-browser-pf-run";

  async function preflight(resources: Resource[], overrides: Record<string, string> = {}) {
    const sandbox = await createSandbox();
    await seedDockerState(sandbox, resources);
    const workDir = sandbox.workDir("preflight");
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "pf-run",
      CSF_ISOLATED_WORK_DIR: workDir,
      ...overrides,
    });
    return { sandbox, result, workDir };
  }

  test("refuses a canonical database volume carrying the exact project label", async () => {
    const { result, sandbox, workDir } = await preflight([
      { kind: "volumes", name: `supabase_db_${project}`, label: project },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Refusing to start: Docker already holds resources");
    expect(result.stderr).toContain(`volume\tlabel\tsupabase_db_${project}`);
    expect(existsSync(workDir)).toBe(false);
    expect(await readCalls(sandbox.supabaseCalls)).toEqual(["--version"]);
  });

  test("refuses a canonical database volume with a missing label", async () => {
    const { result, sandbox } = await preflight([
      { kind: "volumes", name: `supabase_db_${project}` },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`volume\tname\tsupabase_db_${project}`);
    expect(result.stderr).toContain("is not fresh-replay evidence and is never adopted");
    expect(await readCalls(sandbox.supabaseCalls)).toEqual(["--version"]);
  });

  test("refuses a canonical database volume with a wrong label", async () => {
    const { result } = await preflight([
      { kind: "volumes", name: `supabase_db_${project}`, label: "someone-else" },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`volume\tname\tsupabase_db_${project}`);
  });

  test("refuses an unexpected resource name carrying the exact project label", async () => {
    const { result } = await preflight([
      { kind: "containers", name: "totally_unexpected_name", label: project },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("container\tlabel\ttotally_unexpected_name");
  });

  test("ignores near-name and near-label controls that belong to other projects", async () => {
    const { result, workDir } = await preflight([
      { kind: "volumes", name: `supabase_db_${project}-suffix`, label: `${project}-suffix` },
      { kind: "volumes", name: `prefix-supabase_db_${project}`, label: "unrelated" },
      { kind: "containers", name: "supabase_db_lets-assist-csf-browser-other", label: "lets-assist-csf-browser-other" },
      { kind: "networks", name: "supabase_network_lets-assist", label: "lets-assist" },
    ]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(workDir, ".lets-assist-csf-isolated-stack"))).toBe(true);
  });

  test("fails closed when read-only Docker enumeration itself fails", async () => {
    const { result, sandbox } = await preflight([], {
      FAKE_DOCKER_ENUMERATION_FAILS: "1",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Read-only Docker preflight failed");
    expect(await readCalls(sandbox.supabaseCalls)).toEqual(["--version"]);
  });

  test("claims are acquired before bundle probes, Docker enumeration, and start", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("ordering");
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "ordering",
      CSF_ISOLATED_WORK_DIR: workDir,
    });

    expect(result.exitCode).toBe(0);
    // The claim directories are gone by now, so prove ordering from the source
    // plus the fact that neither lsof nor docker ran before them.
    const launcher = readFileSync(launcherPath, "utf8");
    const projectClaim = launcher.indexOf('if ! mkdir "${PROJECT_CLAIM}" 2>/dev/null; then');
    const portClaim = launcher.indexOf("claim_port_bundle || PORT_CLAIM_STATUS=$?");
    const preflightCall = launcher.indexOf('PREFLIGHT_RESOURCES="$(collect_project_resources)"');
    const bundlePortCheck = launcher.indexOf(
      "assert_loopback_port_free",
      preflightCall,
    );
    const appPortCheck = launcher.indexOf(
      "assert_loopback_port_free",
      launcher.indexOf("# Fixed app port 3000"),
    );
    const claimRootCreate = launcher.indexOf('if ! mkdir -p "${CLAIM_ROOT}"; then');
    const startCall = launcher.indexOf('supabase start --workdir "${WORK_DIR}"');
    const workDirCreate = launcher.indexOf('if ! mkdir "${WORK_DIR}"; then');

    expect(projectClaim).toBeGreaterThan(-1);
    expect(portClaim).toBeGreaterThan(projectClaim);
    expect(preflightCall).toBeGreaterThan(portClaim);
    expect(bundlePortCheck).toBeGreaterThan(portClaim);
    expect(workDirCreate).toBeGreaterThan(portClaim);
    expect(startCall).toBeGreaterThan(workDirCreate);

    // The fixed app port is checked before the first persistent mutation:
    // before the claim root, project claim, work directory, or `supabase start`.
    expect(appPortCheck).toBeGreaterThan(-1);
    expect(appPortCheck).toBeLessThan(claimRootCreate);
    expect(appPortCheck).toBeLessThan(projectClaim);
    expect(appPortCheck).toBeLessThan(workDirCreate);
    expect(appPortCheck).toBeLessThan(startCall);

    // Production probes bind only the exact loopback port. The filesystem-wide
    // lsof behavior remains available solely to this hermetic fake harness.
    const probeStart = launcher.indexOf("probe_loopback_port() {");
    const probeEnd = launcher.indexOf("assert_loopback_port_free() {");
    const probeSource = launcher.slice(probeStart, probeEnd);
    expect(probeSource).toContain('node - "${port}"');
    expect(probeSource).toContain('host: "127.0.0.1"');
    expect(probeSource).toContain(
      'CSF_ISOLATED_TEST_CLAIM_ROOT:-}" == "hermetic-test"',
    );

    // Nine bundle ports plus the fixed app port, and the app port went first.
    const lsofCalls = await readCalls(sandbox.lsofCalls);
    expect(lsofCalls.length).toBe(10);
    expect(lsofCalls[0]).toContain("-iTCP:3000");
    expect(lsofCalls.filter((call) => call.includes("-iTCP:3000")).length).toBe(1);
  });

  test("optional analytics exclusion is explicit and keeps the owned launcher path", async () => {
    const sandbox = await createSandbox();
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "no-analytics",
      CSF_ISOLATED_WORK_DIR: sandbox.workDir("no-analytics"),
      CSF_ISOLATED_ANALYTICS_MODE: "disabled",
    });

    expect(result.exitCode).toBe(0);
    const starts = (await readCalls(sandbox.supabaseCalls)).filter((call) =>
      call.startsWith("start "),
    );
    expect(starts).toHaveLength(1);
    expect(starts[0]).toContain("--exclude analytics");
    const generatedConfig = await readFile(
      join(sandbox.workDir("no-analytics"), "supabase", "config.toml"),
      "utf8",
    );
    expect(generatedConfig).toContain("[analytics]\nenabled = false");
  });

  test("unknown analytics modes fail before any Supabase mutation", async () => {
    const sandbox = await createSandbox();
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "bad-analytics",
      CSF_ISOLATED_WORK_DIR: sandbox.workDir("bad-analytics"),
      CSF_ISOLATED_ANALYTICS_MODE: "sometimes",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "CSF_ISOLATED_ANALYTICS_MODE must be exactly enabled or disabled.",
    );
    expect(await readCalls(sandbox.supabaseCalls)).toEqual(["--version"]);
  });

  test("an occupied app port stops the launcher before any workdir or Supabase call", async () => {
    const sandbox = await createSandbox();
    // An lsof that reports port 3000 as listening and every other port as free.
    await writeFile(
      join(sandbox.fakeBin, "lsof"),
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "${FAKE_LSOF_CALLS:-/dev/null}"',
        'for arg in "$@"; do',
        '  if [ "$arg" = "-iTCP:3000" ]; then exit 0; fi',
        "done",
        "exit 1",
        "",
      ].join("\n"),
    );
    await chmod(join(sandbox.fakeBin, "lsof"), 0o700);

    const workDir = sandbox.workDir("appport");
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "appport",
      CSF_ISOLATED_WORK_DIR: workDir,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("The fixed isolated app port 3000 is already in use");
    // Zero mutations of any kind: no work directory, no claim, no Supabase call
    // beyond the pinned version check, and no Docker enumeration.
    expect(existsSync(workDir)).toBe(false);
    expect(await claimEntries(sandbox)).toEqual([]);
    expect(await readCalls(sandbox.supabaseCalls)).toEqual(["--version"]);
    expect(await readCalls(sandbox.dockerCalls)).toEqual([]);
    // And it never got as far as probing a Supabase bundle port.
    expect(await readCalls(sandbox.lsofCalls)).toEqual(["-nP -iTCP:3000 -sTCP:LISTEN"]);
  });

  test("a base port that would collide with the fixed app port is refused", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("collide");
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "collide",
      CSF_ISOLATED_WORK_DIR: workDir,
      // base + 1 == 3000
      CSF_ISOLATED_BASE_PORT: "2999",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "would place a Supabase service on the fixed app port 3000",
    );
    expect(existsSync(workDir)).toBe(false);
    expect(await claimEntries(sandbox)).toEqual([]);
    expect(await readCalls(sandbox.lsofCalls)).toEqual([]);
  });

  async function expectPostStartRefusal(
    runId: string,
    overrides: Parameters<typeof postStartEnvironment>[1],
    expected: string,
  ) {
    const sandbox = await createSandbox();
    const projectId = `lets-assist-csf-browser-${runId}`;
    const workDir = sandbox.workDir(`post-${runId}`);
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: runId,
      CSF_ISOLATED_WORK_DIR: workDir,
      ...postStartEnvironment(projectId, overrides),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(expected);
    expect(result.stderr).toContain("Refusing to record isolated ownership");
    // The marker never gets promoted, and cleanup ran exactly once.
    expect(await readFile(join(workDir, ".lets-assist-csf-isolated-stack"), "utf8")).toContain(
      "state=starting",
    );
    const stops = (await readCalls(sandbox.supabaseCalls)).filter((call) =>
      call.startsWith("stop "),
    );
    expect(stops.length).toBe(1);
    expect(await claimEntries(sandbox)).toEqual([]);
  }

  test("post-start missing, ambiguous, and wrong-label database volumes all refuse", async () => {
    await expectPostStartRefusal(
      "post-missing",
      { omitDatabaseVolume: true },
      "has no labeled database volume",
    );

    await expectPostStartRefusal(
      "post-ambiguous",
      {
        volumes: [
          pinnedDatabaseVolumeName("lets-assist-csf-browser-post-ambiguous"),
          "leaked_unexpected_volume",
        ],
      },
      "names outside the canonical volume set",
    );

    await expectPostStartRefusal(
      "post-wronglabel",
      { databaseVolumeLabel: "someone-else" },
      "has no labeled database volume",
    );
  }, 60_000);

  test("cross-kind name collisions fail closed for every resource kind", async () => {
    // A volume named like the canonical Kong container is not a volume the CLI
    // creates, so it can never satisfy the ownership proof.
    const volumeRunId = "xkind-volume";
    const volumeProject = `lets-assist-csf-browser-${volumeRunId}`;
    const containerName = pinnedResourceNames(volumeProject, "container").find(
      (name) => name.startsWith("supabase_kong_"),
    )!;
    await expectPostStartRefusal(
      volumeRunId,
      {
        volumes: [pinnedDatabaseVolumeName(volumeProject), containerName],
      },
      "volumes carry label",
    );

    // At this tag every named volume (db, storage) is also a container name, so
    // a "volume name used as a container" is legitimate rather than a
    // violation. The container-kind collision that is expressible is the
    // network-only name appearing as a container.
    expect(
      PINNED_SUPABASE_CLI_RESOURCE_PREFIXES.volume.every((prefix) =>
        (PINNED_SUPABASE_CLI_RESOURCE_PREFIXES.container as readonly string[]).includes(
          prefix,
        ),
      ),
    ).toBe(true);

    const containerRunId = "xkind-contain";
    const containerProject = `lets-assist-csf-browser-${containerRunId}`;
    const networkOnlyName = pinnedResourceNames(containerProject, "network")[0];
    await expectPostStartRefusal(
      containerRunId,
      {
        containers: [networkOnlyName],
      },
      "containers carry label",
    );

    // The same network-only name is equally foreign in the volume kind.
    const volumeKindRunId = "xkind-netvol";
    const volumeKindProject = `lets-assist-csf-browser-${volumeKindRunId}`;
    await expectPostStartRefusal(
      volumeKindRunId,
      {
        volumes: [
          pinnedDatabaseVolumeName(volumeKindProject),
          pinnedResourceNames(volumeKindProject, "network")[0],
        ],
      },
      "volumes carry label",
    );

    // And so is a network named like a canonical container.
    const networkRunId = "xkind-network";
    const networkProject = `lets-assist-csf-browser-${networkRunId}`;
    const networkCollision = pinnedResourceNames(networkProject, "container").find(
      (name) => name.startsWith("supabase_rest_"),
    )!;
    await expectPostStartRefusal(
      networkRunId,
      {
        networks: [networkCollision],
      },
      "networks carry label",
    );
  }, 90_000);
});

describe("isolated launcher concurrency and cleanup matrix", () => {
  async function launchHeldStack(sandbox: Sandbox, runId: string, basePort: string) {
    const releaseFile = join(sandbox.directory, "release");
    const workDir = sandbox.workDir(`held-${runId}`);
    const held = Bun.spawn(["/bin/bash", launcherPath], {
      cwd: repositoryRoot,
      env: launcherEnvironment(sandbox, {
        CSF_ISOLATED_RUN_ID: runId,
        CSF_ISOLATED_WORK_DIR: workDir,
        CSF_ISOLATED_BASE_PORT: basePort,
        FAKE_START_WAIT_FILE: releaseFile,
      }),
      stdout: "pipe",
      stderr: "pipe",
    });

    const markerPath = join(workDir, ".lets-assist-csf-isolated-stack");
    for (let attempt = 0; attempt < 400 && !existsSync(markerPath); attempt += 1) {
      await Bun.sleep(25);
    }
    if (!existsSync(markerPath)) throw new Error("held launcher never reached its marker");
    return { held, releaseFile };
  }

  test("a concurrent peer cannot take the same project, the same base, or an overlapping bundle", async () => {
    const sandbox = await createSandbox();
    const { held, releaseFile } = await launchHeldStack(sandbox, "hold-a", "61000");

    try {
      const sameProject = launch(sandbox, {
        CSF_ISOLATED_RUN_ID: "hold-a",
        CSF_ISOLATED_WORK_DIR: sandbox.workDir("peer-same-project"),
      });
      expect(sameProject.exitCode).toBe(1);
      expect(sameProject.stderr).toContain(
        "Another isolated launch already owns project lets-assist-csf-browser-hold-a.",
      );
      expect(existsSync(sandbox.workDir("peer-same-project"))).toBe(false);

      const sameBase = launch(sandbox, {
        CSF_ISOLATED_RUN_ID: "peer-b",
        CSF_ISOLATED_WORK_DIR: sandbox.workDir("peer-same-base"),
      });
      expect(sameBase.exitCode).toBe(1);
      expect(sameBase.stderr).toContain("Port 61000 is already claimed");

      // Bundles {B..B+7, B+9} and {B+8..B+15, B+17} intersect only at B+9.
      const overlapping = launch(sandbox, {
        CSF_ISOLATED_RUN_ID: "peer-c",
        CSF_ISOLATED_WORK_DIR: sandbox.workDir("peer-overlap"),
        CSF_ISOLATED_BASE_PORT: "61008",
      });
      expect(overlapping.exitCode).toBe(1);
      expect(overlapping.stderr).toContain("Port 61009 is already claimed");

      const disjoint = launch(sandbox, {
        CSF_ISOLATED_RUN_ID: "peer-d",
        CSF_ISOLATED_WORK_DIR: sandbox.workDir("peer-disjoint"),
        CSF_ISOLATED_BASE_PORT: "61020",
      });
      expect(disjoint.exitCode).toBe(0);

      // The refused peers rolled their partial bundles back completely: only the
      // held launch and the disjoint one still own claims.
      const claims = await claimEntries(sandbox);
      expect(claims).toContain("project-lets-assist-csf-browser-hold-a");
      expect(claims).not.toContain("project-lets-assist-csf-browser-peer-b");
      expect(claims).not.toContain("project-lets-assist-csf-browser-peer-c");
      expect(claims).not.toContain("port-61008");
      expect(claims).not.toContain("port-61020");
    } finally {
      await writeFile(releaseFile, "");
      await held.exited;
    }

    expect(held.exitCode).toBe(0);
    expect(await claimEntries(sandbox)).toEqual([]);
  }, 60_000);

  test("a conflicting bundle rolls every acquired port claim back", async () => {
    const sandbox = await createSandbox();
    // Conflict on the last offset so the first eight claims are acquired and then
    // rolled back. None of them may survive for the next launch to trip over.
    await mkdir(sandbox.claimRoot, { recursive: true, mode: 0o700 });
    await mkdir(join(sandbox.claimRoot, "port-61009"), { mode: 0o700 });

    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "rollback",
      CSF_ISOLATED_WORK_DIR: sandbox.workDir("rollback"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Port 61009 is already claimed");
    expect(result.stderr).not.toContain("Failed to roll back");
    expect(await claimEntries(sandbox)).toEqual(["port-61009"]);
    expect(existsSync(sandbox.workDir("rollback"))).toBe(false);
  });

  test("a port claim that cannot be released stops the stack and retains exact ownership", async () => {
    const sandbox = await createSandbox();
    const { held, releaseFile } = await launchHeldStack(sandbox, "wedged", "61000");
    // While the launch holds its bundle, wedge one claim so rmdir must fail. The
    // launcher may not hand off a stack whose ownership it cannot release.
    await writeFile(join(sandbox.claimRoot, "port-61003", "wedged"), "");
    await writeFile(releaseFile, "");
    await held.exited;

    const stderr = await new Response(held.stderr).text();
    expect(held.exitCode).toBe(1);
    expect(stderr).toContain("Failed to release the isolated port claim");
    expect(stderr).toContain("refusing to hand off an unowned stack");
    expect(stderr).toContain("Retained these exact isolated claims");

    const stops = (await readCalls(sandbox.supabaseCalls)).filter((call) =>
      call.startsWith("stop "),
    );
    expect(stops.length).toBe(1);

    const claims = await claimEntries(sandbox);
    expect(claims).toContain("project-lets-assist-csf-browser-wedged");
    expect(claims).toContain("port-61003");
    const recovery = await readFile(
      join(sandbox.claimRoot, "project-lets-assist-csf-browser-wedged", "recovery"),
      "utf8",
    );
    expect(recovery).toContain("project_id=lets-assist-csf-browser-wedged");
    expect(recovery).toContain("port-61003");
  }, 60_000);

  test("every partial rollback and release is individually checked in source", () => {
    const launcher = readFileSync(launcherPath, "utf8");
    const rollback = launcher.slice(
      launcher.indexOf("claim_port_bundle() {"),
      launcher.indexOf("release_claims() {"),
    );
    const release = launcher.slice(
      launcher.indexOf("release_claims() {"),
      launcher.indexOf("retain_claims() {"),
    );

    expect(rollback).toContain('if ! rmdir "${index}"; then');
    expect(rollback).toContain("rollback_failed=1");
    expect(rollback).toContain("return 2");
    expect(release).toContain('if rmdir "${claim}"; then');
    // A failed port release must not clear the held state or drop the project
    // claim: the identity stays owned until every claim is actually gone.
    expect(release).toContain("if ((failed == 0)); then\n      PORT_CLAIMS_HELD=false");
    expect(release).toContain('RETAINED_CLAIMS="${remaining}${PROJECT_CLAIM}"');
    expect(launcher).not.toContain("|| true");
    expect(launcher).not.toContain("mkdir -p \"${WORK_DIR}\"");
    expect(launcher.indexOf("STACK_READY=true")).toBeGreaterThan(
      launcher.indexOf("if ! release_claims; then"),
    );
  });

  test("start failure with a clean stop reports once and releases every claim", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("start-fail");
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "start-fail",
      CSF_ISOLATED_WORK_DIR: workDir,
      FAKE_SUPABASE_START_FAIL: "1",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("supabase start failed for isolated project");
    expect(result.stderr).toContain("Its temporary files remain at");
    expect(result.stderr).not.toContain("Retained these exact isolated claims");
    expect(await claimEntries(sandbox)).toEqual([]);
    const stops = (await readCalls(sandbox.supabaseCalls)).filter((call) => call.startsWith("stop "));
    expect(stops.length).toBe(1);
  });

  test("start failure with a failing stop preserves both failures and retains claims", async () => {
    const sandbox = await createSandbox();
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "stop-fail",
      CSF_ISOLATED_WORK_DIR: sandbox.workDir("stop-fail"),
      FAKE_SUPABASE_START_FAIL: "1",
      FAKE_SUPABASE_STOP_FAIL: "1",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("supabase start failed for isolated project");
    expect(result.stderr).toContain("Bounded cleanup failed: supabase stop returned nonzero");
    expect(result.stderr).toContain("primary status 1 is preserved");
    expect(await claimEntries(sandbox)).toContain("project-lets-assist-csf-browser-stop-fail");
    expect(
      existsSync(join(sandbox.claimRoot, "project-lets-assist-csf-browser-stop-fail", "recovery")),
    ).toBe(true);
  });

  test("a stop that leaves residual resources is treated as a cleanup failure", async () => {
    const sandbox = await createSandbox();
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "residual",
      CSF_ISOLATED_WORK_DIR: sandbox.workDir("residual"),
      ...postStartEnvironment("lets-assist-csf-browser-residual", {
        omitDatabaseVolume: true,
      }),
      FAKE_STOP_LEAVES: "1",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Bounded cleanup left Docker resources");
    expect(result.stderr).toContain("Retained these exact isolated claims");
    expect(await claimEntries(sandbox)).toContain("project-lets-assist-csf-browser-residual");
  });
});

// ---------------------------------------------------------------------------
// Verifier outcome matrix, driven through a fake repository so no real gate,
// database, or provider runs.
// ---------------------------------------------------------------------------

async function createFakeRepository(sandbox: Sandbox) {
  const root = join(sandbox.directory, "repo");
  await mkdir(join(root, "scripts/local-dev"), { recursive: true });
  await mkdir(join(root, "supabase"), { recursive: true });
  await mkdir(join(root, "tmp"), { recursive: true });

  for (const script of [
    "verify-supabase-redesign.sh",
    "start-dvhs-csf-isolated-stack.sh",
    "stop-dvhs-csf-isolated-stack.sh",
    "require-supabase-cli-version.sh",
  ]) {
    const target = join(root, "scripts/local-dev", script);
    await cp(join(repositoryRoot, "scripts/local-dev", script), target);
    await chmod(target, 0o700);
  }
  await cp(
    join(repositoryRoot, "scripts/local-dev/dv-local-env.mjs"),
    join(root, "scripts/local-dev/dv-local-env.mjs"),
  );
  await cp(
    join(repositoryRoot, "supabase/config.toml"),
    join(root, "supabase/config.toml"),
  );
  return root;
}

function runVerifier(
  sandbox: Sandbox,
  root: string,
  overrides: Record<string, string>,
) {
  const nodeDirectory = dirname(resolveNodeExecutable());
  const result = Bun.spawnSync(
    ["/bin/bash", join(root, "scripts/local-dev/verify-supabase-redesign.sh")],
    {
      cwd: root,
      env: {
        PATH: `${sandbox.fakeBin}:${nodeDirectory}:/usr/bin:/bin:/usr/sbin:/sbin`,
        HOME: process.env.HOME ?? sandbox.directory,
        TMPDIR: join(root, "tmp"),
        FAKE_DOCKER_STATE: sandbox.dockerState,
        FAKE_SUPABASE_CALLS: sandbox.supabaseCalls,
        FAKE_DOCKER_CALLS: sandbox.dockerCalls,
        FAKE_BUN_CALLS: join(sandbox.directory, "bun-calls.log"),
        FAKE_DEFAULT_CONTAINER_PREFIXES:
          PINNED_SUPABASE_CLI_RESOURCE_PREFIXES.container.join(" "),
        FAKE_DEFAULT_VOLUME_PREFIXES:
          PINNED_SUPABASE_CLI_RESOURCE_PREFIXES.volume.join(" "),
        FAKE_DEFAULT_NETWORK_PREFIXES:
          PINNED_SUPABASE_CLI_RESOURCE_PREFIXES.network.join(" "),
        CSF_ISOLATED_CLAIM_ROOT: sandbox.claimRoot,
        CSF_ISOLATED_TEST_CLAIM_ROOT: "hermetic-test",
        DV_LOCAL_TEST_PASSWORD: "fake-run-scoped-password",
        ...overrides,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}\n${result.stderr.toString()}`,
  };
}

describe("redesign verifier cleanup matrix", () => {
  test("(main 0, cleanup 0) passes only after teardown is accounted for", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, {});

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Isolated stack origin: generated clean migration replay");
    expect(result.output).toContain("Stopped isolated Supabase project");
    expect(result.output).toContain(
      "PASS: DVHS CSF local isolated replay gate completed on one generated isolated stack.",
    );
    const supabaseCalls = await readCalls(sandbox.supabaseCalls);
    expect(supabaseCalls.filter((call) => call.startsWith("start ")).length).toBe(1);
    expect(supabaseCalls.filter((call) => call.startsWith("test db")).length).toBe(1);
    expect(supabaseCalls.some((call) => call.includes("db reset"))).toBe(false);
  }, 60_000);

  test("(main N, cleanup 0) preserves the gate status", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, { FAKE_BUN_FAIL: "typecheck" });

    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("Stopped isolated Supabase project");
    expect(result.output).toContain("FAIL: DVHS CSF local isolated replay gate did not complete.");
    expect(result.output).not.toContain("isolated stack teardown failed");
  }, 60_000);

  test("(main 0, cleanup C) turns a clean gate into the cleanup failure status", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, { FAKE_SUPABASE_STOP_FAIL: "1" });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("FAIL: isolated stack teardown failed with status 1.");
    expect(result.output).toContain("FAIL: gate steps passed, but isolated stack cleanup failed.");
    expect(result.output).not.toContain("PASS: DVHS CSF local isolated replay gate");
  }, 60_000);

  test("(main N, cleanup C) keeps the primary status while reporting cleanup", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);

    const result = runVerifier(sandbox, root, {
      FAKE_BUN_FAIL: "typecheck",
      FAKE_SUPABASE_STOP_FAIL: "1",
    });

    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("FAIL: isolated stack teardown failed with status 1.");
    expect(result.output).toContain("Preserving the original gate failure status 3.");
  }, 60_000);

  test("a caller-owned prepared stack is verified but never started, stopped, or deleted", async () => {
    const sandbox = await createSandbox("csf-verifier-");
    const root = await createFakeRepository(sandbox);
    const preparedWorkDir = join(root, "tmp", "prepared");

    const prepared = Bun.spawnSync(
      ["/bin/bash", join(root, "scripts/local-dev/start-dvhs-csf-isolated-stack.sh")],
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
    expect(result.output).toContain("Isolated stack origin: caller-owned prepared stack");
    expect(result.output).toContain("Prepared-Stack App Environment");
    expect(result.output).toContain(
      "PASS: DVHS CSF local isolated replay gate completed on one caller-owned prepared stack.",
    );
    expect(result.output).not.toContain("clean migration replay");

    const calls = await readCalls(sandbox.supabaseCalls);
    expect(calls.some((call) => call.startsWith("start "))).toBe(false);
    expect(calls.some((call) => call.startsWith("stop "))).toBe(false);
    expect(calls.some((call) => call.includes("db reset"))).toBe(false);
    expect(existsSync(join(preparedWorkDir, ".lets-assist-csf-isolated-stack"))).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Source contracts: CI job slice, verifier, and workflow gate.
// ---------------------------------------------------------------------------

// Parse only the db-replay-validation job: no assertion here may be satisfied by
// an unrelated job elsewhere in the workflow.
function dbReplayJob() {
  const workflow = readFileSync(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  const marker = "\n  db-replay-validation:\n";
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error("db-replay-validation job is missing from ci.yml");
  const body = workflow.slice(start + marker.length);
  const nextJob = /^ {2}[A-Za-z][A-Za-z0-9_-]*:\s*$/mu.exec(body);
  return nextJob ? body.slice(0, nextJob.index) : body;
}

describe("db-replay-validation CI job contract", () => {
  test("starts exactly one launcher and never resets or nests a replay", () => {
    const job = dbReplayJob();

    expect(
      job.match(/scripts\/local-dev\/start-dvhs-csf-isolated-stack\.sh/gu)?.length,
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

    expect(job).toContain("node scripts/local-dev/dv-local-env.mjs --print-app-env");
    expect(job).not.toContain('source "${CSF_ISOLATED_WORK_DIR}/lets-assist-browser.sh"');
    expect(job).not.toMatch(/source .*lets-assist-browser\.sh/u);
    expect(job).toContain("node scripts/local-dev/dv-local-env.mjs --csf-health");
    expect(job).not.toContain("dv-local-env.mjs --health");
  });

  test("generates one bounded run ID and requires an absent work directory", () => {
    const job = dbReplayJob();

    expect(job).toContain("- name: Allocate one bounded isolated run identity");
    expect(job).toContain('if [[ ! "${run_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$ ]]; then');
    expect(job).toContain('if [[ -e "${work_dir}" || -L "${work_dir}" ]]; then');
    expect(job).not.toContain(
      "CSF_ISOLATED_RUN_ID: ci-${{ github.run_id }}-${{ github.run_attempt }}",
    );
  });

  test("step labels are truthful and one marker-bounded stop always runs", () => {
    const job = dbReplayJob();

    expect(job).toContain("- name: Validate CSF database workflows");
    expect(job).not.toContain("Validate CSF workflows and public privacy boundary");
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
      job.indexOf("- name: Validate database tests on the same running isolated stack"),
    );
    const firstMask = startStep.indexOf("printf '::add-mask::%s");
    const maskCaseStart = startStep.indexOf('case "${key}" in');
    const maskCaseEnd = startStep.indexOf("esac", maskCaseStart);
    const environmentExport = startStep.indexOf('printf \'%s=%s\\n\' "${key}" "${!key}" >> "${GITHUB_ENV}"');
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
    const ciWorkflow = readFileSync(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
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
    const teardownStep = ciWorkflow.indexOf("- name: Stop isolated Let’s Assist Supabase");

    expect(ciWorkflow).toContain(
      "CSF_E2E_RUN_ID: ci-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(playwrightConfig).toContain('process.env.CSF_E2E_RUN_ID ?? "playwright-local"');
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
    JSON.stringify({ name: "@supabase/supabase-js", version: "0.0.0-fake", type: "module", main: "index.mjs" }),
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
  }> = existsSync(journalPath) ? JSON.parse(await readFile(journalPath, "utf8")) : [];

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    journal,
    // The exact ID arrays each cleanup was asked to delete, in order.
    cleanupIds: (table: string) =>
      journal.filter((entry) => entry.op === "delete" && entry.table === table).map(
        (entry) => entry.ids ?? [],
      ),
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
    expect(result.cleanupIds("csf_submission_files")).toEqual([["probe-proof-1"]]);
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
    expect(result.stderr).toContain("Database did not enforce one proof per CSF submission");
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
    expect(result.cleanupIds("csf_submission_files")).toEqual([["probe-proof-1"]]);
    expect(result.cleanupIds("csf_credit_records")).toEqual([["probe-credit-9"]]);
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
    expect(result.cleanupIds("csf_submission_files")).toEqual([["probe-proof-1"]]);
    expect(result.cleanupIds("csf_credit_records")).toEqual([["probe-credit-1"]]);
  });

  test("a cleanup that removes nothing fails the run with the stranded IDs", async () => {
    const result = await runWorkflowProbe({
      proofCleanup: { data: [], error: null },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("csf_submission_files probe cleanup left probe-proof-1 in place.");
  });

  test("a primary failure is preserved while every cleanup failure is reported", async () => {
    const result = await runWorkflowProbe({
      duplicateProofInsert: { data: null, error: { code: "00000", message: "no constraint" } },
      proofCleanup: { data: null, error: { message: "delete refused" } },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("CSF probe cleanup failure: csf_submission_files probe cleanup failed: delete refused");
    expect(result.stderr).toContain("Database did not enforce one proof per CSF submission");
  });

  test("an explicit CSF_APP_URL makes route unavailability its own distinct failure", async () => {
    const result = await runWorkflowProbe({}, {
      // Reserved discard port: the request is attempted and fails to connect.
      CSF_APP_URL: "http://127.0.0.1:9",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.fetchCount).toBeGreaterThan(0);
    expect(result.stderr).toContain("was unreachable at the explicit CSF_APP_URL");
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
    const ciWorkflow = readFileSync(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

    expect(playwrightConfig).toContain("CSF_PROFILE_CLAIM_SECRET");
    expect(playwrightConfig).toContain("csf-profile-claim-secret");
    expect(playwrightConfig).toContain("readFileSync");
    expect(playwrightConfig).toContain("ambientProfileClaimSecret !== profileClaimSecret");
    expect(stackLauncher).toContain("CSF_PROFILE_CLAIM_SECRET");
    expect(stackLauncher).toContain("csf-profile-claim-secret");
    expect(stackLauncher).toContain("randomBytes(32)");
    expect(playwrightConfig).not.toContain("createHash");
    expect(stackLauncher).not.toContain("createHash");
    expect(stackLauncher).not.toContain("process.env.SERVICE_ROLE_KEY");
    expect(stackLauncher).toContain("emit_app_env_value CSF_PROFILE_CLAIM_SECRET");
    expect(ciWorkflow).toContain("CSF_PROFILE_CLAIM_SECRET");
    expect(ciWorkflow).toContain("id: start-isolated");
    expect(ciWorkflow).toContain(
      "if: ${{ always() && steps.start-isolated.outcome == 'success' }}",
    );
    for (const testFile of [
      "lib/auth/theme-script-boundary.test.ts",
      "scripts/local-dev/csf-browser-harness.test.ts",
      "services/google-drive-metadata.test.ts",
      "services/google-sheets-report-safety.test.ts",
      "services/google-sheets-source-snapshot.test.ts",
    ]) {
      expect(ciWorkflow).toContain(testFile);
    }
  });
});

// ---------------------------------------------------------------------------
// Recovery topology, remote-readiness separation, and runbook contracts.
// ---------------------------------------------------------------------------

describe("recovery base port", () => {
  test("defaults to the 55320 recovery bundle", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("base-default");

    // Empty rather than absent: the launcher's `:-` default must still apply.
    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "base-default",
      CSF_ISOLATED_WORK_DIR: workDir,
      CSF_ISOLATED_BASE_PORT: "",
    });

    expect(result.exitCode).toBe(0);
    const marker = await readFile(join(workDir, ".lets-assist-csf-isolated-stack"), "utf8");
    expect(marker).toContain("base_port=55320");

    const config = await readFile(join(workDir, "supabase", "config.toml"), "utf8");
    // The exact recovery bundle: API 55321, DB 55322, Studio 55323, Mailpit UI
    // 55324, SMTP 55325, edge inspector 55326, analytics 55327, pooler 55329.
    for (const port of [55320, 55321, 55322, 55323, 55324, 55325, 55326, 55327, 55329]) {
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
    expect(await readFile(join(workDir, ".lets-assist-csf-isolated-stack"), "utf8")).toContain(
      "base_port=61000",
    );
  }, 60_000);

  test("the launcher source keeps 55320 as the default and refuses an out-of-range base", () => {
    const launcherSource = readFileSync(launcherPath, "utf8");
    expect(launcherSource).toContain('BASE_PORT="${CSF_ISOLATED_BASE_PORT:-55320}"');
    expect(launcherSource).not.toContain("56350");
    // Allocator collision refusal is preserved.
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
      expect(source, `${file} must not name the protected legacy stack`).not.toContain("56450");
      for (const port of ["56451", "56452", "56453", "56454", "56455", "56456", "56457"]) {
        expect(source, `${file} must not name ${port}`).not.toContain(port);
      }
    }
  });
});

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

    const result = runVerifier(sandbox, root, { CSF_REQUIRE_REMOTE_READINESS: "1" });

    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain("Remote readiness: NOT EVALUATED");
    expect(result.output).toContain("Supabase Remote Server-Only Readiness Audit (explicitly required)");
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
    expect(result.output).toContain("FAIL: DVHS CSF local isolated replay gate did not complete.");
    expect(result.output).not.toContain("PASS: DVHS CSF local isolated replay gate");
  }, 60_000);

  test("any other nonempty value fails before starting anything", async () => {
    for (const value of ["true", "yes", "0", "on", "TRUE", "1 ", "01"]) {
      const sandbox = await createSandbox("csf-verifier-");
      const root = await createFakeRepository(sandbox);

      const result = runVerifier(sandbox, root, { CSF_REQUIRE_REMOTE_READINESS: value });

      expect(result.exitCode, `value=${JSON.stringify(value)}`).not.toBe(0);
      expect(result.output).toContain("CSF_REQUIRE_REMOTE_READINESS must be unset, empty, or exactly 1");
      // Nothing started: no launcher, no stack, no teardown.
      const supabaseCalls = await readCalls(sandbox.supabaseCalls);
      expect(supabaseCalls.filter((call) => call.startsWith("start "))).toEqual([]);
      expect(supabaseCalls.filter((call) => call.startsWith("stop "))).toEqual([]);
    }
  }, 120_000);

  test("the audit script itself is untouched by this wave", () => {
    const auditSource = readFileSync(
      join(repositoryRoot, "scripts/audit-supabase-remote-readiness.sh"),
      "utf8",
    );
    const digest = new Bun.CryptoHasher("sha256").update(auditSource).digest("hex");
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

    expect(job).toContain("CSF_ISOLATED_BASE_PORT: '55320'");
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

describe("CI runs the previously missing tests as separate processes", () => {
  const separatelyRunTests = [
    "scripts/local-dev/seed-platform.test.ts",
    "scripts/local-dev/cron-auth-shape-probe.test.ts",
    "scripts/local-dev/test-cron-endpoints.test.ts",
    "scripts/local-dev/run-dvhs-csf-isolated-app.test.ts",
  ];

  test("each missing test file is named exactly once in the quality job", () => {
    const job = ciJob("quality");
    for (const file of separatelyRunTests) {
      expect(job.split(file).length - 1, file).toBe(1);
    }
  });

  test("no two of them share a bun test invocation", () => {
    const job = ciJob("quality");
    // One `bun test ...` command per file, and no command names two of them.
    const commands = job.split("bun test").slice(1);
    for (const command of commands) {
      const named = separatelyRunTests.filter((file) => command.includes(file));
      expect(named.length, command.slice(0, 120)).toBeLessThanOrEqual(1);
    }
    for (const file of separatelyRunTests) {
      expect(
        commands.filter((command) => command.includes(file)).length,
        file,
      ).toBe(1);
    }
  });

  test("the cron probe suite keeps its server-only preload", () => {
    const job = ciJob("quality");
    const step = job.slice(
      job.indexOf("- name: Cron auth/shape probe tests"),
      job.indexOf("- name: Cron harness contract tests"),
    );
    expect(step).toContain("--preload ./scripts/local-dev/server-only-test-preload.ts");
    expect(step).toContain("scripts/local-dev/cron-auth-shape-probe.test.ts");
  });

  test("the workflow states why the split exists", () => {
    const workflow = ciWorkflowSource();
    expect(workflow).toContain("module mocks");
    expect(workflow).toContain("Bun's module registry is per-process");
  });
});

describe("CI replays the five-route cron smoke in the right order", () => {
  test("dev:test:cron runs after seeding and before Playwright", () => {
    const job = dbReplayJob();
    const seed = job.indexOf("- name: Seed fictional platform and DV fixtures");
    const cron = job.indexOf("run: bun run dev:test:cron");
    const playwrightInstall = job.indexOf("- name: Install Playwright Chromium");
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
    expect(filters).not.toContain("- 'app/api/cron/organization-sheet-sync/**'");
  });

  test("CI still contacts neither Production nor preview", () => {
    const workflow = ciWorkflowSource();
    expect(workflow).not.toContain("fotdmeakexgrkronxlof");
    expect(workflow).not.toContain("qitbdwqobjpiixfwhhyo");
    expect(workflow).not.toContain("supabase link");
    expect(workflow).not.toContain("--linked");
    // The isolated launcher and the remote-readiness opt-in are unchanged.
    expect(workflow).toContain("scripts/local-dev/start-dvhs-csf-isolated-stack.sh");
    expect(workflow).not.toContain("CSF_REQUIRE_REMOTE_READINESS");
  });
});

describe("both browser suites start only the isolated app runner", () => {
  const configs = ["playwright.csf.config.ts", "playwright.dv.config.ts"];

  test("each web server is the runner on the owned fixed port", () => {
    for (const file of configs) {
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      expect(source, file).toContain(
        'command: "node scripts/local-dev/bootstrap-dvhs-csf-dev.mjs"',
      );
      expect(source, file).toContain("CSF_ISOLATED_APP_PORT");
      expect(source, file).toContain("reuseExistingServer: false");
      expect(source, file).not.toContain("...process.env");
      expect(source, file).not.toContain("next dev");
      expect(source, file).not.toContain("3100");
      expect(source, file).not.toContain("3113");
    }
  });

  test("the CSF suite keeps its route and project selection", () => {
    const source = readFileSync(join(repositoryRoot, "playwright.csf.config.ts"), "utf8");
    expect(source).toContain('testDir: "./tests/csf"');
    expect(source).toContain('testMatch: "**/*.spec.ts"');
    expect(source).toContain('name: "chromium"');
    expect(source).toContain('process.env.CSF_E2E_RUN_ID ?? "playwright-local"');
  });

  test("the DV suite keeps its route and project selection", () => {
    const source = readFileSync(join(repositoryRoot, "playwright.dv.config.ts"), "utf8");
    expect(source).toContain('testDir: "./tests/dv"');
    expect(source).toContain('name: "chromium"');
  });
});

describe("runbooks lead with the isolated contract", () => {
  const readme = readFileSync(join(repositoryRoot, "scripts/local-dev/README.md"), "utf8");
  const fixtures = readFileSync(
    join(repositoryRoot, "scripts/local-dev/README-fixtures.md"),
    "utf8",
  );

  test("the CSF recovery sections lead with the isolated launcher and the exact-byte loader", () => {
    for (const source of [readme, fixtures]) {
      expect(source).toContain("scripts/local-dev/start-dvhs-csf-isolated-stack.sh");
      expect(source).toContain("node scripts/local-dev/dv-local-env.mjs --print-app-env");
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
    const block = readme.slice(start, readme.indexOf("### The recovery sequence", start));
    expect(block).toContain("| `bun run supabase` |");
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
    expect(prohibition).toContain("| `bun run dev:next` |");
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
      join(repositoryRoot, "scripts/local-dev/start-dvhs-csf-isolated-stack.sh"),
      "utf8",
    );
    expect(launcher).toContain('echo "App command: bun run dev');
    expect(launcher).not.toContain("bun run dev -- --port 3000");
  });

  test("the fixture reseed guidance is shared local, non-CSF only", () => {
    expect(fixtures).toContain("How to Re-Seed — shared local, non-CSF only");
    expect(fixtures).toContain("It seeds **no** DVHS CSF data");
    // The old claim that the shared bootstrap seeds DVHS CSF is gone.
    expect(fixtures).not.toContain("seeds the\n> default platform and DVHS CSF fixtures");
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

  test("the five-route cron claim is exact and names what it excludes", () => {
    expect(readme).toContain(
      "the five selected worker routes:\n  auto-publish-hours, project-cancellations, organization-calendar-sync,\n  organization-sheet-sync, and data-exports",
    );
    for (const outside of [
      "`ai-moderation`",
      "`anonymous-cleanup`",
      "`csf-communications-dispatch`",
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
    const recovery = readme.slice(readme.indexOf("## DVHS CSF recovery — isolated only"));
    // They appear only inside the prohibition table, never as instructions.
    const prohibition = recovery.slice(
      recovery.indexOf("### Prohibited for DVHS CSF recovery"),
      recovery.indexOf("### The recovery sequence"),
    );
    for (const forbidden of ["supabase db reset", "--linked", "| `bun run supabase` |"]) {
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
