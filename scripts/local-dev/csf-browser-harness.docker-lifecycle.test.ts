import { describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  repositoryRoot,
  launcherPath,
  postStartEnvironment,
  createSandbox,
  seedDockerState,
  launcherEnvironment,
  launch,
  readCalls,
  claimEntries,
} from "./csf-browser-harness.fixture";
import type { Resource, Sandbox } from "./csf-browser-harness.fixture";
import {
  PINNED_SUPABASE_CLI_RESOURCE_PREFIXES,
  pinnedDatabaseVolumeName,
  pinnedResourceNames,
} from "./pinned-supabase-cli-resources.fixture";

describe("isolated launcher Docker identity matrix", () => {
  const project = "lets-assist-csf-browser-pf-run";

  async function preflight(
    resources: Resource[],
    overrides: Record<string, string> = {},
  ) {
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
    expect(result.stderr).toContain(
      "Refusing to start: Docker already holds resources",
    );
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
    expect(result.stderr).toContain(
      "is not fresh-replay evidence and is never adopted",
    );
    expect(await readCalls(sandbox.supabaseCalls)).toEqual(["--version"]);
  });

  test("refuses a canonical database volume with a wrong label", async () => {
    const { result } = await preflight([
      {
        kind: "volumes",
        name: `supabase_db_${project}`,
        label: "someone-else",
      },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`volume\tname\tsupabase_db_${project}`);
  });

  test("refuses an unexpected resource name carrying the exact project label", async () => {
    const { result } = await preflight([
      { kind: "containers", name: "totally_unexpected_name", label: project },
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "container\tlabel\ttotally_unexpected_name",
    );
  });

  test("ignores near-name and near-label controls that belong to other projects", async () => {
    const { result, workDir } = await preflight([
      {
        kind: "volumes",
        name: `supabase_db_${project}-suffix`,
        label: `${project}-suffix`,
      },
      {
        kind: "volumes",
        name: `prefix-supabase_db_${project}`,
        label: "unrelated",
      },
      {
        kind: "containers",
        name: "supabase_db_lets-assist-csf-browser-other",
        label: "lets-assist-csf-browser-other",
      },
      {
        kind: "networks",
        name: "supabase_network_lets-assist",
        label: "lets-assist",
      },
    ]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(workDir, ".lets-assist-csf-isolated-stack"))).toBe(
      true,
    );
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
    const projectClaim = launcher.indexOf(
      'if ! mkdir "${PROJECT_CLAIM}" 2>/dev/null; then',
    );
    const portClaim = launcher.indexOf(
      "claim_port_bundle || PORT_CLAIM_STATUS=$?",
    );
    const preflightCall = launcher.indexOf(
      'PREFLIGHT_RESOURCES="$(collect_project_resources)"',
    );
    const bundlePortCheck = launcher.indexOf(
      "assert_host_port_free",
      preflightCall,
    );
    const appPortCheck = launcher.indexOf(
      "assert_host_port_free",
      launcher.indexOf("# Fixed app port (3000 unless CSF_ISOLATED_APP_PORT"),
    );
    const claimRootCreate = launcher.indexOf(
      'if ! mkdir -p "${CLAIM_ROOT}"; then',
    );
    const startCall = launcher.indexOf(
      'supabase start --workdir "${WORK_DIR}"',
    );
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

    // Production probes bind the same wildcard host scope Docker publishes.
    // The filesystem-wide lsof behavior remains solely for this fake harness.
    const probeStart = launcher.indexOf("probe_host_port() {");
    const probeEnd = launcher.indexOf("assert_host_port_free() {");
    const probeSource = launcher.slice(probeStart, probeEnd);
    expect(probeSource).toContain('node - "${port}"');
    expect(probeSource).toContain('host: "0.0.0.0"');
    expect(probeSource).toContain(
      'CSF_ISOLATED_TEST_CLAIM_ROOT:-}" == "hermetic-test"',
    );

    // Nine bundle ports plus the fixed app port, and the app port went first.
    const lsofCalls = await readCalls(sandbox.lsofCalls);
    expect(lsofCalls.length).toBe(10);
    expect(lsofCalls[0]).toContain("-iTCP:3000");
    expect(lsofCalls.filter((call) => call.includes("-iTCP:3000")).length).toBe(
      1,
    );
  });

  test("optional analytics disablement uses config without an obsolete exclusion name", async () => {
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
    expect(starts[0]).not.toContain("--exclude analytics");
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
    expect(result.stderr).toContain(
      "The fixed isolated app port 3000 is already in use",
    );
    // Zero mutations of any kind: no work directory, no claim, no Supabase call
    // beyond the pinned version check, and no Docker enumeration.
    expect(existsSync(workDir)).toBe(false);
    expect(await claimEntries(sandbox)).toEqual([]);
    expect(await readCalls(sandbox.supabaseCalls)).toEqual(["--version"]);
    expect(await readCalls(sandbox.dockerCalls)).toEqual([]);
    // And it never got as far as probing a Supabase bundle port.
    expect(await readCalls(sandbox.lsofCalls)).toEqual([
      "-nP -iTCP:3000 -sTCP:LISTEN",
    ]);
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
    expect(
      await readFile(join(workDir, ".lets-assist-csf-isolated-stack"), "utf8"),
    ).toContain("state=starting");
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
        (
          PINNED_SUPABASE_CLI_RESOURCE_PREFIXES.container as readonly string[]
        ).includes(prefix),
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
    const networkCollision = pinnedResourceNames(
      networkProject,
      "container",
    ).find((name) => name.startsWith("supabase_rest_"))!;
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
  async function launchHeldStack(
    sandbox: Sandbox,
    runId: string,
    basePort: string,
  ) {
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
    for (
      let attempt = 0;
      attempt < 400 && !existsSync(markerPath);
      attempt += 1
    ) {
      await Bun.sleep(25);
    }
    if (!existsSync(markerPath))
      throw new Error("held launcher never reached its marker");
    return { held, releaseFile };
  }

  test("a concurrent peer cannot take the same project, the same base, or an overlapping bundle", async () => {
    const sandbox = await createSandbox();
    const { held, releaseFile } = await launchHeldStack(
      sandbox,
      "hold-a",
      "61000",
    );

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
    const { held, releaseFile } = await launchHeldStack(
      sandbox,
      "wedged",
      "61000",
    );
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
      join(
        sandbox.claimRoot,
        "project-lets-assist-csf-browser-wedged",
        "recovery",
      ),
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
    expect(release).toContain(
      "if ((failed == 0)); then\n      PORT_CLAIMS_HELD=false",
    );
    expect(release).toContain('RETAINED_CLAIMS="${remaining}${PROJECT_CLAIM}"');
    expect(launcher).not.toContain("|| true");
    expect(launcher).not.toContain('mkdir -p "${WORK_DIR}"');
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
    expect(result.stderr).toContain(
      "supabase start failed for isolated project",
    );
    expect(result.stderr).toContain("Its temporary files remain at");
    expect(result.stderr).not.toContain("Retained these exact isolated claims");
    expect(await claimEntries(sandbox)).toEqual([]);
    const stops = (await readCalls(sandbox.supabaseCalls)).filter((call) =>
      call.startsWith("stop "),
    );
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
    expect(result.stderr).toContain(
      "supabase start failed for isolated project",
    );
    expect(result.stderr).toContain(
      "Bounded cleanup failed: supabase stop returned nonzero",
    );
    expect(result.stderr).toContain("primary status 1 is preserved");
    expect(await claimEntries(sandbox)).toContain(
      "project-lets-assist-csf-browser-stop-fail",
    );
    expect(
      existsSync(
        join(
          sandbox.claimRoot,
          "project-lets-assist-csf-browser-stop-fail",
          "recovery",
        ),
      ),
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
    expect(await claimEntries(sandbox)).toContain(
      "project-lets-assist-csf-browser-residual",
    );
  });
});

// ---------------------------------------------------------------------------
// Verifier outcome matrix, driven through a fake repository so no real gate,
// database, or provider runs.
// ---------------------------------------------------------------------------
