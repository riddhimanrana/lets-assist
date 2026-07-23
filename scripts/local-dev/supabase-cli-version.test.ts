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
  test("accepts exactly 2.109.1", async () => {
    const result = await runHelperWithVersion("2.109.1");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("2.109.1 verified");
  });

  test("rejects any other Supabase CLI version", async () => {
    const result = await runHelperWithVersion("2.110.0");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "2.109.1 is required; found 2.110.0",
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
    await writeFile(fakeCli, "#!/bin/sh\nprintf '%s\\n' '2.109.1'\n");
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
    await writeFile(fakeCli, "#!/bin/sh\nprintf '%s\\n' '2.109.1'\n");
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
    await writeFile(fakeCli, "#!/bin/sh\nprintf '%s\\n' '2.109.1'\n");
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
    await writeFile(fakeCli, "#!/bin/sh\nprintf '%s\\n' '2.109.1'\n");
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
    expect(source).toContain("Missing generated isolated stack marker");
    expect(source).toContain('docker volume ls -q --filter');
    expect(source).toContain('docker network ls -q --filter');
    expect(source).not.toContain("work directory name does not match project_id");
  });

  test("the redesign verifier delegates to generated isolation", async () => {
    const source = await readFile(
      path.join(
        repositoryRoot,
        "scripts/local-dev/verify-supabase-redesign.sh",
      ),
      "utf8",
    );
    expect(source).toContain("start-dvhs-csf-isolated-stack.sh");
    expect(source).toContain("stop-dvhs-csf-isolated-stack.sh");
    expect(source).toContain('supabase db reset --local --yes --workdir "${CSF_ISOLATED_WORK_DIR}"');
    expect(source).toContain("node scripts/local-dev/dv-local-env.mjs --health");
    expect(source).toContain("CRON_TEST_BASE_URL=http://127.0.0.1:3009");
    expect(source).not.toContain('run_step "Local Supabase Replay + Fixtures" bun run supabase');
    expect(source).not.toContain("stop-next-dev.mjs");
  });

  test("CI requires CSF and never resets or stops the shared repository stack", async () => {
    const source = await readFile(
      path.join(repositoryRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(source).toContain("Require DVHS CSF private plugin and browser suite");
    expect(source).toContain("DVHS CSF browser specs are required");
    expect(source).toContain("Start isolated Let’s Assist Supabase");
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
});
