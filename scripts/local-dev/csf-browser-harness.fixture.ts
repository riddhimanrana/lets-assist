import { afterEach } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PINNED_SUPABASE_CLI_RESOURCE_PREFIXES,
  pinnedDatabaseVolumeName,
  pinnedResourceNames,
} from "./pinned-supabase-cli-resources.fixture";

export const repositoryRoot = process.cwd();
export const launcherPath = join(
  repositoryRoot,
  "scripts/local-dev/start-dvhs-csf-isolated-stack.sh",
);
export const generatedDirectories: string[] = [];

// Any of these appearing as its own argv token would be a mutating Docker call.
export const MUTATING_DOCKER_VERBS = [
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
export function resolveNodeExecutable() {
  const resolved = Bun.which("node");
  if (!resolved)
    throw new Error("a real node executable is required for these tests");
  return resolved;
}

afterEach(async () => {
  await Promise.all(
    generatedDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

// ---------------------------------------------------------------------------
// Hermetic fakes. Nothing here may reach the real Docker or Supabase CLI: the
// sandbox installs a fake `docker`, `supabase`, and `lsof` ahead of the real
// PATH, and every launcher run asserts the fake docker is actually present.
// ---------------------------------------------------------------------------

export const FAKE_SUPABASE = [
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
  '  project_id=$(sed -n \'s/^project_id = "\\(.*\\)"$/\\1/p\' "$workdir/supabase/config.toml" | head -n 1)',
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
  "    materialize() {",
  '      kind_file="$1"',
  "      shift",
  "      for prefix in $*; do",
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
  '        awk -F\'\\t\' -v p="$project_id" \'$2 != p && $1 !~ ("_" p "$")\' "${state}/${f}" > "${state}/${f}.next"',
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

export const FAKE_DOCKER = [
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

export const FAKE_LSOF = [
  "#!/bin/sh",
  'printf "%s\\n" "$*" >> "${FAKE_LSOF_CALLS:-/dev/null}"',
  "exit 1",
  "",
].join("\n");

export const FAKE_BUN = [
  "#!/bin/sh",
  'printf "%s\\n" "$*" >> "${FAKE_BUN_CALLS:-/dev/null}"',
  'if [ "$1" = "run" ] && [ -n "${FAKE_BUN_FAIL:-}" ] && [ "$2" = "${FAKE_BUN_FAIL}" ]; then',
  '  echo "fake bun failure for $2" >&2',
  "  exit 3",
  "fi",
  "exit 0",
  "",
].join("\n");

export type Resource = {
  kind: "containers" | "volumes" | "networks";
  name: string;
  label?: string;
};

// Every canonical name these tests use comes from the checked-in pinned-CLI
// oracle, never from the implementation under test.
export function canonicalStartResources(projectId: string) {
  return {
    containers: pinnedResourceNames(projectId, "container"),
    volumes: pinnedResourceNames(projectId, "volume"),
    networks: pinnedResourceNames(projectId, "network"),
  };
}

export function labelledRecords(names: string[], label: string) {
  return names.map((name) => `${name}\t${label}`).join("\n");
}

export function postStartEnvironment(
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
    .filter(
      (name) => !(overrides.omitDatabaseVolume && name === databaseVolume),
    )
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

export type Sandbox = {
  directory: string;
  fakeBin: string;
  dockerState: string;
  claimRoot: string;
  supabaseCalls: string;
  dockerCalls: string;
  lsofCalls: string;
  workDir: (name: string) => string;
};

export async function createSandbox(
  prefix = "csf-isolated-",
): Promise<Sandbox> {
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

export async function seedDockerState(sandbox: Sandbox, resources: Resource[]) {
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

export function launcherEnvironment(
  sandbox: Sandbox,
  overrides: Record<string, string>,
) {
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

export function launch(sandbox: Sandbox, overrides: Record<string, string>) {
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

export async function readCalls(file: string) {
  if (!existsSync(file)) return [] as string[];
  return (await readFile(file, "utf8")).split("\n").filter(Boolean);
}

export async function claimEntries(sandbox: Sandbox) {
  if (!existsSync(sandbox.claimRoot)) return [] as string[];
  const { readdir } = await import("node:fs/promises");
  return (await readdir(sandbox.claimRoot)).sort();
}
