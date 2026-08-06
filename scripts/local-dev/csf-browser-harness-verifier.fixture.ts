import { chmod, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  repositoryRoot,
  resolveNodeExecutable,
} from "./csf-browser-harness.fixture";
import type { Sandbox } from "./csf-browser-harness.fixture";
import { PINNED_SUPABASE_CLI_RESOURCE_PREFIXES } from "./pinned-supabase-cli-resources.fixture";

export async function createFakeRepository(sandbox: Sandbox) {
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

export function runVerifier(
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
