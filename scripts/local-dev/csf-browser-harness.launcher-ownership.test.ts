import { describe, expect, test } from "bun:test";
import {
  chmod,
  cp,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  repositoryRoot,
  launcherPath,
  MUTATING_DOCKER_VERBS,
  createSandbox,
  seedDockerState,
  launcherEnvironment,
  launch,
  readCalls,
  claimEntries,
} from "./csf-browser-harness.fixture";
import type { Resource, Sandbox } from "./csf-browser-harness.fixture";
import {
  pinnedDatabaseVolumeName,
  pinnedResourceNames,
} from "./pinned-supabase-cli-resources.fixture";

describe("isolated launcher ownership contract", () => {
  test("records one ready stack, releases every claim, and never mutates Docker", async () => {
    const sandbox = await createSandbox();
    const workDir = sandbox.workDir("ready");

    const result = launch(sandbox, {
      CSF_ISOLATED_RUN_ID: "behavior-test",
      CSF_ISOLATED_WORK_DIR: workDir,
    });

    expect(result.exitCode).toBe(0);
    const marker = await readFile(
      join(workDir, ".lets-assist-csf-isolated-stack"),
      "utf8",
    );
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

    const appEnvironment = await readFile(
      join(workDir, "lets-assist-browser.sh"),
      "utf8",
    );
    expect(appEnvironment).toContain(
      `export CSF_PROFILE_CLAIM_SECRET='${profileSecret}'`,
    );
    expect(appEnvironment).toContain(
      "export NEXT_PUBLIC_SITE_URL='http://localhost:3000'",
    );
    expect(appEnvironment).toContain(
      "export NEXT_PUBLIC_VERCEL_URL='localhost:3000'",
    );
    expect(
      await readFile(join(workDir, "supabase-start.log"), "utf8"),
    ).toContain("fake-start-credential-stdout");

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
    expect(result.stdout).toContain(
      `Project: lets-assist-csf-browser-${"a".repeat(16)}`,
    );
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
    expect(launcher).toContain(
      'CLAIM_ROOT="/tmp/lets-assist-csf-isolated-claims-$(id -u)"',
    );
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
    expect(result.stdout).toContain(
      "Isolated project: lets-assist-csf-browser-stop-ok",
    );
    expect(result.stdout).toContain("Marker state: ready");

    // The stop path enumerates all three kinds and still issues only read-only
    // Docker calls; deletion is Supabase's job, bounded by --project-id.
    const dockerCalls = await readCalls(sandbox.dockerCalls);
    expect(dockerCalls.some((call) => call.startsWith("ps -a"))).toBe(true);
    expect(dockerCalls.some((call) => call.startsWith("volume ls"))).toBe(true);
    expect(dockerCalls.some((call) => call.startsWith("network ls"))).toBe(
      true,
    );
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
    expect(
      (await readCalls(sandbox.supabaseCalls)).filter((call) =>
        call.startsWith("stop "),
      ),
    ).toEqual([]);
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
    await writeFile(
      markerPath,
      await readFile(join(other, ".lets-assist-csf-isolated-stack"), "utf8"),
    );
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
      await writeFile(
        target,
        `#!/bin/sh\nexec ${JSON.stringify(executable)} "$@"\n`,
      );
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
    expect(result.stderr).toContain(
      "docker is required to prove residual state",
    );
    expect(
      (await readCalls(sandbox.supabaseCalls)).filter((call) =>
        call.startsWith("stop "),
      ),
    ).toEqual([]);
    expect(retainedEvidence(workDir)).toEqual({
      workDir: true,
      marker: true,
      config: true,
      startLog: true,
    });
    expect(result.stderr).toContain(
      "allocator recovery evidence are preserved",
    );
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
      (await readCalls(sandbox.supabaseCalls)).filter((call) =>
        call.startsWith("stop "),
      ),
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
    expect(result.stdout).toContain(
      "Docker residual proof: no container, volume, or network remains",
    );
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
      (await readCalls(sandbox.supabaseCalls)).filter((call) =>
        call.startsWith("stop "),
      ),
    ).toEqual([]);
    expect(existsSync(workDir)).toBe(true);
  }, 90_000);

  test("deletion authority is unreachable in source without the completed proof flag", () => {
    const stopSource = readFileSync(stopPath, "utf8");
    const proofLine = stopSource.indexOf("RESIDUAL_PROOF_COMPLETE=true");
    const deleteLine = stopSource.indexOf('rm -rf -- "${WORK_DIR}"');
    const guardLine = stopSource.indexOf(
      'if [[ "${RESIDUAL_PROOF_COMPLETE}" != true ]]; then',
    );

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
      (await readCalls(sandbox.supabaseCalls)).filter((call) =>
        call.startsWith("stop "),
      ),
    ).toEqual([]);
    expect(existsSync(workDir)).toBe(true);
    expect(existsSync(join(workDir, ".lets-assist-csf-isolated-stack"))).toBe(
      true,
    );
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
          label:
            name === names.databaseVolume ? "someone-elses-project" : projectId,
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
          .map((name) => ({
            kind: "volumes" as const,
            name,
            label: projectId,
          }));
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
    await expectRefusal("inspectfail", () => [], "could not inspect", {
      FAKE_DOCKER_INSPECT_FAILS: "1",
    });
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
    expect(stops[0]).toContain(
      "--project-id lets-assist-csf-browser-validready",
    );
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
      {
        kind: "containers",
        name: `supabase_db_${projectId}`,
        label: projectId,
      },
      {
        kind: "volumes",
        name: pinnedDatabaseVolumeName(projectId),
        label: projectId,
      },
      {
        kind: "networks",
        name: `supabase_network_${projectId}`,
        label: projectId,
      },
    ]);

    const result = stop(sandbox, workDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Marker state: starting");
    expect(
      (await readCalls(sandbox.supabaseCalls)).filter((call) =>
        call.startsWith("stop "),
      ).length,
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
      {
        kind: "containers",
        name: `supabase_db_${projectId}`,
        label: projectId,
      },
      { kind: "containers", name: "someone-elses-sidecar", label: projectId },
      {
        kind: "volumes",
        name: pinnedDatabaseVolumeName(projectId),
        label: projectId,
      },
      {
        kind: "networks",
        name: `supabase_network_${projectId}`,
        label: projectId,
      },
    ]);

    const result = stop(sandbox, workDir, ["--delete-workdir"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("refused an unexpected container");
    await assertZeroMutation(sandbox, workDir);
  }, 90_000);

  test("a dry run performs the full validation and still stops nothing", async () => {
    const valid = await createSandbox();
    const validWorkDir = await readyStack(valid, "dryok");
    const validRun = stop(valid, validWorkDir, [
      "--dry-run",
      "--delete-workdir",
    ]);
    expect(validRun.exitCode).toBe(0);
    expect(validRun.stdout).toContain("Pre-stop ownership validation:");
    expect(
      (await readCalls(valid.supabaseCalls)).filter((call) =>
        call.startsWith("stop "),
      ),
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
      {
        kind: "containers",
        name: "someone-elses-sidecar",
        label: invalidProject,
      },
    ]);
    const invalidRun = stop(invalid, invalidWorkDir, [
      "--dry-run",
      "--delete-workdir",
    ]);
    expect(invalidRun.exitCode).not.toBe(0);
    expect(invalidRun.stderr).toContain("refused an unexpected container");
    expect(invalidRun.stdout).not.toContain("Dry run: no containers");
    await assertZeroMutation(invalid, invalidWorkDir);
  }, 120_000);

  test("validation is source-ordered before dry-run handling and before any stop", () => {
    const stopSource = readFileSync(stopPath, "utf8");
    const validate = stopSource.indexOf(
      'if ! validate_owned_inventory "${PRE_STOP_RESOURCES}"; then',
    );
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
