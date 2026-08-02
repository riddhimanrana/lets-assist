import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dir, "../..");
const helper = path.join(
  repositoryRoot,
  "scripts/local-dev/require-supabase-cli-version.sh",
);
const generatedDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    generatedDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function runHelperWithVersion(version: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "supabase-cli-version-"));
  generatedDirectories.push(directory);
  const fakeCli = path.join(directory, "supabase");
  await writeFile(fakeCli, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
  await chmod(fakeCli, 0o700);

  return Bun.spawnSync(["/bin/bash", helper], {
    env: { PATH: `${directory}:/usr/bin:/bin` },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("pinned Supabase CLI helper", () => {
  test("accepts exactly 2.111.0", async () => {
    const result = await runHelperWithVersion("2.111.0");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("2.111.0 verified");
  });

  test("rejects any other Supabase CLI version", async () => {
    const result = await runHelperWithVersion("2.110.0");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "2.111.0 is required; found 2.110.0",
    );
  });

  test("all isolated CSF lifecycle scripts invoke the shared check", async () => {
    const scripts = [
      "start-dvhs-csf-isolated-stack.sh",
      "stop-dvhs-csf-isolated-stack.sh",
      "test-dvhs-csf-isolated-db.sh",
    ];

    for (const script of scripts) {
      const source = await readFile(
        path.join(repositoryRoot, "scripts/local-dev", script),
        "utf8",
      );
      expect(source).toContain('source "${SCRIPT_DIR}/require-supabase-cli-version.sh"');
      expect(source).toContain("require_supabase_cli_version");
      expect(source).not.toContain("bunx supabase");
    }
  });

  test("replay rejects path-like run IDs before creating or deleting anything", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "supabase-replay-safety-"));
    generatedDirectories.push(directory);
    const fakeBin = path.join(directory, "bin");
    await Bun.write(path.join(directory, "sentinel.txt"), "keep");
    await mkdir(fakeBin);
    const fakeCli = path.join(fakeBin, "supabase");
    await writeFile(fakeCli, "#!/bin/sh\nprintf '%s\\n' '2.111.0'\n");
    await chmod(fakeCli, 0o700);

    const result = Bun.spawnSync(
      [
        "/bin/bash",
        path.join(
          repositoryRoot,
          "scripts/local-dev/test-dvhs-csf-isolated-db.sh",
        ),
      ],
      {
        cwd: repositoryRoot,
        env: {
          PATH: `${fakeBin}:/usr/bin:/bin`,
          CSF_REPLAY_RUN_ID: "owned/../../../escape",
          CSF_REPLAY_TMP_ROOT: path.join(directory, "replays"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "CSF_REPLAY_RUN_ID must contain only",
    );
    expect(await readFile(path.join(directory, "sentinel.txt"), "utf8")).toBe(
      "keep",
    );
  });

  test("browser-stack startup rejects path-like run IDs before creating anything", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "supabase-start-safety-"));
    generatedDirectories.push(directory);
    const fakeBin = path.join(directory, "bin");
    await mkdir(fakeBin);
    const fakeCli = path.join(fakeBin, "supabase");
    await writeFile(fakeCli, "#!/bin/sh\nprintf '%s\\n' '2.111.0'\n");
    await chmod(fakeCli, 0o700);
    const target = path.join(directory, "must-not-exist");

    const result = Bun.spawnSync(
      [
        "/bin/bash",
        path.join(
          repositoryRoot,
          "scripts/local-dev/start-dvhs-csf-isolated-stack.sh",
        ),
      ],
      {
        cwd: repositoryRoot,
        env: {
          PATH: `${fakeBin}:/usr/bin:/bin`,
          CSF_ISOLATED_RUN_ID: "owned/../../../escape",
          CSF_ISOLATED_WORK_DIR: target,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "CSF_ISOLATED_RUN_ID must contain only",
    );
    expect(await Bun.file(target).exists()).toBe(false);
  });

  test("generated Supabase project IDs cannot exceed the CLI's 40-character limit", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "supabase-project-id-safety-"));
    generatedDirectories.push(directory);
    const fakeBin = path.join(directory, "bin");
    await mkdir(fakeBin);
    const fakeCli = path.join(fakeBin, "supabase");
    await writeFile(fakeCli, "#!/bin/sh\nprintf '%s\\n' '2.111.0'\n");
    await chmod(fakeCli, 0o700);

    for (const [script, key] of [
      ["start-dvhs-csf-isolated-stack.sh", "CSF_ISOLATED_RUN_ID"],
      ["test-dvhs-csf-isolated-db.sh", "CSF_REPLAY_RUN_ID"],
    ] as const) {
      const result = Bun.spawnSync(
        ["/bin/bash", path.join(repositoryRoot, "scripts/local-dev", script)],
        {
          cwd: repositoryRoot,
          env: {
            PATH: `${fakeBin}:/usr/bin:/bin`,
            [key]: "a".repeat(17),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("1-16 letters");
    }
  });

  test("replay rejects a temp-root symlink that resolves into the repository", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "supabase-replay-root-"));
    generatedDirectories.push(directory);
    const fakeBin = path.join(directory, "bin");
    await mkdir(fakeBin);
    const fakeCli = path.join(fakeBin, "supabase");
    await writeFile(fakeCli, "#!/bin/sh\nprintf '%s\\n' '2.111.0'\n");
    await chmod(fakeCli, 0o700);
    const rootLink = path.join(directory, "repo-link");
    await symlink(repositoryRoot, rootLink);

    const result = Bun.spawnSync(
      [
        "/bin/bash",
        path.join(
          repositoryRoot,
          "scripts/local-dev/test-dvhs-csf-isolated-db.sh",
        ),
      ],
      {
        cwd: repositoryRoot,
        env: {
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          HOME: process.env.HOME ?? directory,
          CSF_REPLAY_RUN_ID: "safe-run-id",
          CSF_REPLAY_TMP_ROOT: rootLink,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Refusing unsafe CSF replay root");
  });

  test("replay cleanup is restricted to a marker-owned direct child", async () => {
    const source = await readFile(
      path.join(
        repositoryRoot,
        "scripts/local-dev/test-dvhs-csf-isolated-db.sh",
      ),
      "utf8",
    );
    expect(source).toContain('OWNERSHIP_MARKER="${TMP_DIR}/.lets-assist-csf-replay-owned"');
    expect(source).toContain('"${owned_parent}" != "${REPLAY_ROOT}"');
    expect(source).toContain('docker volume ls -q --filter');
    expect(source).toContain('docker network ls -q --filter');
    expect(source).toContain("trap - EXIT");
    expect(source).toContain('rm -rf -- "${TMP_DIR}"');
  });

  test("isolated stack cleanup requires the generated marker", async () => {
    const source = await readFile(
      path.join(
        repositoryRoot,
        "scripts/local-dev/stop-dvhs-csf-isolated-stack.sh",
      ),
      "utf8",
    );
    // The stop path no longer parses the marker itself: it consumes the one
    // shared non-executing validator and its bounded exact-key handoff.
    expect(source).toContain(
      'node "${SCRIPT_DIR}/dv-local-env.mjs" --validate-stack-target',
    );
    expect(source).not.toContain("sed -nE");
    expect(source).not.toContain("read_marker_field");
    // The shell builtin, not the word inside a comment.
    expect(source).not.toMatch(/(^|[;&|(\s])eval\s/mu);
    expect(source).not.toMatch(/source\s+"?\$\{?MARKER_FILE/u);
    expect(source).toContain("Refusing an unexpected isolated stack handoff key");
    expect(source).not.toContain("work directory name does not match project_id");

    // Validation precedes every stop, Docker call, and deletion.
    const validation = source.indexOf("--validate-stack-target");
    expect(validation).toBeGreaterThan(-1);
    expect(source.indexOf("supabase stop \\")).toBeGreaterThan(validation);
    expect(source.indexOf("collect_project_resources()")).toBeGreaterThan(validation);
    expect(source.indexOf('rm -rf -- "${WORK_DIR}"')).toBeGreaterThan(validation);

    // Residual checks enumerate containers, volumes, and networks by both the
    // exact project label and the pinned canonical names, so a resource whose
    // label was lost is still caught.
    expect(source).toContain('docker ps -a --filter "label=${PROJECT_LABEL}"');
    expect(source).toContain('docker volume ls --filter "label=${PROJECT_LABEL}"');
    expect(source).toContain('docker network ls --filter "label=${PROJECT_LABEL}"');
    expect(source).toContain("docker ps -a --format '{{.Names}}'");
    expect(source).toContain("docker volume ls --format '{{.Name}}'");
    expect(source).toContain("docker network ls --format '{{.Name}}'");
    for (const kind of ["container", "volume", "network"]) {
      expect(source).toContain(`--canonical-docker-names ${kind}`);
    }
    expect(source).toContain('docker volume inspect "${MARKER_DB_VOLUME}"');
    expect(source).toContain("Refusing a symlinked isolated work directory");
    expect(source).toContain("is not this directory");
    expect(source.indexOf("MARKER_WORK_DIR")).toBeLessThan(
      source.indexOf("supabase stop \\"),
    );
  });

  test("the redesign verifier runs one launcher-owned stack with no reset or nested replay", async () => {
    const source = await readFile(
      path.join(
        repositoryRoot,
        "scripts/local-dev/verify-supabase-redesign.sh",
      ),
      "utf8",
    );

    // Exactly one launcher, one stop, one target identity.
    expect(source.match(/start-dvhs-csf-isolated-stack\.sh/gu)?.length).toBe(1);
    expect(source.match(/stop-dvhs-csf-isolated-stack\.sh/gu)?.length).toBe(1);

    // No reset, no linked command, no shared stack, no nested replay script.
    expect(source).not.toContain("supabase db reset");
    expect(source).not.toContain("csf:test:db:isolated");
    expect(source).not.toContain("--linked");
    expect(source).not.toContain("bun run supabase:start");
    expect(source).not.toContain("bun run supabase:reset");
    expect(source).not.toContain('run_step "Local Supabase Replay + Fixtures" bun run supabase');
    expect(source).not.toContain("stop-next-dev.mjs");

    // pgTAP runs against the same already-running work directory.
    expect(source).toContain('supabase test db --workdir "${CSF_ISOLATED_WORK_DIR}"');

    expect(source).toContain("node scripts/local-dev/dv-local-env.mjs --csf-health");
    // The cron harness owns its server and refuses to adopt one, so the verifier
    // must not hand it a base URL to point at.
    expect(source).not.toContain("CRON_TEST_BASE_URL");
    // The label now states the harness's exact scope: the five selected worker
    // routes, not "every operational cron route".
    expect(source).toContain(
      '"Cron Auth/Shape Smoke — five selected worker routes (no dispatch, no egress)" \\',
    );
    expect(source).toContain("bun run dev:test:cron");
    expect(source).toContain(
      "organization-calendar-sync, organization-sheet-sync, and data-exports.",
    );
  });

  test("the verifier loads the app environment by exact bytes, never by sourcing a pathname", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "scripts/local-dev/verify-supabase-redesign.sh"),
      "utf8",
    );

    expect(source).toContain("node scripts/local-dev/dv-local-env.mjs --print-app-env");
    expect(source).not.toMatch(/source\s+.*lets-assist-browser\.sh/u);
    expect(source).not.toContain("set -a");

    // Validation and exact-byte loading precede every live command and the seeds.
    const load = source.indexOf('run_step "${APP_ENV_STEP_LABEL}" load_validated_app_environment');
    const liveIdentity = source.indexOf('run_step "${TARGET_STEP_LABEL}"');
    const pgTap = source.indexOf('run_step "${PGTAP_STEP_LABEL}"');
    // The isolated-mode seed script only: the shared-local one would select the
    // shared 54321 stack and then reset-upsert its CSF tables.
    expect(source).not.toContain("bun run supabase:seed:local-dev");
    const platformSeed = source.indexOf("bun run csf:seed:platform:isolated");
    const dvSeed = source.indexOf("bun run dv:fixtures");
    const workflows = source.indexOf('run_step "${WORKFLOW_STEP_LABEL}"');

    expect(load).toBeGreaterThan(-1);
    expect(liveIdentity).toBeGreaterThan(load);
    expect(pgTap).toBeGreaterThan(liveIdentity);
    expect(platformSeed).toBeGreaterThan(pgTap);
    expect(dvSeed).toBeGreaterThan(platformSeed);
    expect(workflows).toBeGreaterThan(dvSeed);
  });

  test("verifier teardown failure is never swallowed", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "scripts/local-dev/verify-supabase-redesign.sh"),
      "utf8",
    );

    expect(source).not.toContain("|| true");
    expect(source).not.toContain(">/dev/null 2>&1");
    expect(source).toContain("trap on_exit EXIT");
    expect(source).toContain("local status=$?");
    expect(source).toContain("trap - EXIT HUP INT TERM");
    expect(source).toContain('if [[ "${CLEANUP_ATTEMPTED}" == true ]]; then');
    expect(source).toContain('Preserving the original gate failure status ${status}.');
    // A caller-owned prepared stack is never stopped or deleted.
    expect(source).toContain('if [[ "${OWNED_ISOLATED_STACK}" != true ]]; then');
  });

  test("the isolated launcher keeps its atomic claim and marker guards", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "scripts/local-dev/start-dvhs-csf-isolated-stack.sh"),
      "utf8",
    );

    expect(source).toContain('if ! mkdir "${PROJECT_CLAIM}" 2>/dev/null; then');
    expect(source).toContain('claim="${CLAIM_ROOT}/port-${port}"');
    expect(source).toContain("acquire_allocator_lock");
    expect(source).toContain('CSF_ISOLATED_CLAIM_ROOT is a test-only override');
    expect(source).toContain("write_marker starting");
    expect(source).toContain("write_marker ready");
    expect(source).toContain('mv -f "${temp_marker}" "${MARKER_FILE}"');
    expect(source).not.toContain("|| true");
    expect(source).not.toMatch(/mkdir -p "\$\{WORK_DIR\}"/u);
  });

  test("CI requires CSF and never resets or stops the shared repository stack", async () => {
    const source = await readFile(
      path.join(repositoryRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(source).toContain("Require DVHS CSF private plugin and browser suite");
    expect(source).toContain("DVHS CSF browser specs are required");
    expect(source).toContain("Start one isolated Let’s Assist Supabase");
    expect(source).toContain("stop-dvhs-csf-isolated-stack.sh");
    expect(source).toContain("Validate CSF browser workflows");
    expect(source).not.toContain("bun run supabase:start");
    expect(source).not.toContain("bun run supabase:reset");
    expect(source).not.toContain("bun run supabase:stop");

    const csfBrowserStep = source.slice(
      source.indexOf("- name: Validate CSF browser workflows"),
      source.indexOf("- name: Verify isolated Supabase remains healthy"),
    );
    expect(csfBrowserStep).not.toContain("if:");
  });

  test("the hermetic fake CLI cannot collude with the implementation's resource list", async () => {
    const harness = await readFile(
      path.join(repositoryRoot, "scripts/local-dev/csf-browser-harness.test.ts"),
      "utf8",
    );

    // The fake Supabase CLI must not ask the implementation what resources
    // exist; if it did, an implementation drift would be mirrored into the
    // "observed" Docker state and no test could see it.
    const fakeCli = harness.slice(
      harness.indexOf("const FAKE_SUPABASE = ["),
      harness.indexOf("const FAKE_DOCKER = ["),
    );
    // Comments may explain the independence; the shell body may not invoke it.
    const fakeCliBody = fakeCli
      .split("\n")
      .filter((line) => !/^\s*"?\s*#/u.test(line.replace(/^\s*['"`]/u, "")))
      .join("\n");
    expect(fakeCliBody).not.toContain("--canonical-docker-names");
    expect(fakeCliBody).not.toContain("dv-local-env.mjs");
    expect(fakeCliBody).not.toContain("CSF_CONTRACT_CLI");
    expect(fakeCliBody).not.toContain("NODE_BIN");
    expect(fakeCli).toContain("FAKE_DEFAULT_CONTAINER_PREFIXES");
    expect(fakeCli).toContain("FAKE_DEFAULT_VOLUME_PREFIXES");
    expect(fakeCli).toContain("FAKE_DEFAULT_NETWORK_PREFIXES");

    // The harness sources its canonical names from the checked-in oracle only.
    expect(harness).toContain('from "./pinned-supabase-cli-resources.fixture"');
    expect(harness).not.toContain("csfCanonicalDockerResourceContract");
    expect(harness).not.toContain("csfCanonicalDockerResourceNames");
  });

  test("the pinned resource oracle is a literal, provenance-anchored fixture", async () => {
    const fixture = await readFile(
      path.join(repositoryRoot, "scripts/local-dev/pinned-supabase-cli-resources.fixture.ts"),
      "utf8",
    );

    // It must not derive anything from the implementation. Provenance comments
    // may reference it; executable code may not.
    const fixtureCode = fixture.replace(/\/\*\*?[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    expect(fixtureCode).not.toContain("dv-local-env");
    expect(fixtureCode).not.toContain("import ");
    expect(fixtureCode).not.toContain("require(");
    // It must name the tag and the files the list was transcribed from.
    expect(fixture).toContain("v2.111.0");
    expect(fixture).toContain("apps/cli-go/internal/utils/config.go");
    expect(fixture).toContain("apps/cli-go/internal/start/start.go");
    // And it must record the names that must never come back.
    for (const unsupported of [
      "supabase_differ_",
      "supabase_migra_",
      "supabase_pg_prove_",
      "supabase_test_",
      "realtime-dev.supabase_realtime_",
      "storage_imgproxy_",
      "supabase_config_",
    ]) {
      expect(fixture).toContain(unsupported);
    }
  });

  test("the workflow gate never ignores a probe cleanup result", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "scripts/local-dev/test-dvhs-csf-workflows.mjs"),
      "utf8",
    );

    expect(source).toContain("} finally {");
    expect(source).toContain('await deleteProbeRows("csf_submission_files", proofProbeIds);');
    expect(source).toContain('await deleteProbeRows("csf_credit_records", creditProbeIds);');
    expect(source).toContain('.delete().in("id", ids).select("id")');
    expect(source).toContain("cleanupFailures.push");
    expect(source).toContain("throw probeFailure;");
    expect(source).toContain(
      "CSF_ISOLATED_WORK_DIR: process.env.CSF_ISOLATED_WORK_DIR",
    );
    expect(source).not.toContain("getCsfIsolatedSupabaseEnv();");
    // A bare delete with no result inspection is exactly what this forbids.
    expect(source).not.toMatch(/await plugin\.from\("csf_submission_files"\)\.delete\(\)\.eq\(/u);
  });
});
