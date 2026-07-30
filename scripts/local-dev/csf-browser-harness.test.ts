import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const generatedDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    generatedDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("isolated CSF browser harness", () => {
  test("keeps generated stack credentials out of launcher output", async () => {
    const root = process.cwd();
    const directory = await mkdtemp(join(tmpdir(), "csf-browser-harness-"));
    generatedDirectories.push(directory);
    const fakeBin = join(directory, "bin");
    const workDir = join(directory, "isolated-stack");
    await mkdir(fakeBin);

    const fakeSupabase = join(fakeBin, "supabase");
    await writeFile(
      fakeSupabase,
      `#!/bin/sh
case "$1" in
  --version)
    printf '%s\\n' '2.109.1'
    ;;
  start)
    printf '%s\\n' 'fake-start-credential-stdout'
    printf '%s\\n' 'fake-start-credential-stderr' >&2
    ;;
  status)
    printf '%s\\n' \\
      'API_URL="http://127.0.0.1:61001"' \\
      'ANON_KEY="fake-anon-token"' \\
      'SERVICE_ROLE_KEY="fake-service-role-token"' \\
      'DB_URL="postgresql://postgres:fake-password@127.0.0.1:61002/postgres"' \\
      'PUBLISHABLE_KEY="sb_publishable_fake-generated-key"' \\
      'SECRET_KEY="sb_secret_fake-generated-key"'
    ;;
  stop)
    ;;
  *)
    exit 1
    ;;
esac
`,
    );
    await chmod(fakeSupabase, 0o700);

    const fakeLsof = join(fakeBin, "lsof");
    await writeFile(fakeLsof, "#!/bin/sh\nexit 1\n");
    await chmod(fakeLsof, 0o700);

    const result = Bun.spawnSync(
      [
        "/bin/bash",
        join(root, "scripts/local-dev/start-dvhs-csf-isolated-stack.sh"),
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          CSF_ISOLATED_RUN_ID: "behavior-test",
          CSF_ISOLATED_WORK_DIR: workDir,
          CSF_ISOLATED_BASE_PORT: "61000",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(0);
    const publicOutput = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    expect(publicOutput).not.toContain("fake-start-credential");
    expect(publicOutput).not.toContain("fake-anon-token");
    expect(publicOutput).not.toContain("fake-service-role-token");
    expect(publicOutput).not.toContain("fake-password");
    expect(publicOutput).not.toContain("sb_publishable_fake-generated-key");
    expect(publicOutput).not.toContain("sb_secret_fake-generated-key");

    const profileSecret = (
      await readFile(join(workDir, "csf-profile-claim-secret"), "utf8")
    ).trim();
    expect(profileSecret).toMatch(/^[a-f0-9]{64}$/u);

    const appEnvironment = await readFile(
      join(workDir, "lets-assist-browser.sh"),
      "utf8",
    );
    expect(appEnvironment).toContain(
      `export CSF_PROFILE_CLAIM_SECRET=${profileSecret}`,
    );
    expect(
      await readFile(join(workDir, "supabase-start.log"), "utf8"),
    ).toContain("fake-start-credential-stdout");

    for (const file of [
      "supabase-browser.env",
      "lets-assist-browser.sh",
      "supabase-start.log",
      "csf-profile-claim-secret",
    ]) {
      expect((await stat(join(workDir, file))).mode & 0o777).toBe(0o600);
    }
  });

  test("shares one random per-stack profile-claim signing secret across launch paths", () => {
    const root = process.cwd();
    const playwrightConfig = readFileSync(
      join(root, "playwright.csf.config.ts"),
      "utf8",
    );
    const stackLauncher = readFileSync(
      join(root, "scripts/local-dev/start-dvhs-csf-isolated-stack.sh"),
      "utf8",
    );
    const ciWorkflow = readFileSync(
      join(root, ".github/workflows/ci.yml"),
      "utf8",
    );

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
    expect(stackLauncher).toMatch(
      /supabase start --workdir "\$\{WORK_DIR\}" --yes >"\$\{START_LOG\}" 2>&1/,
    );
    expect(stackLauncher).toMatch(
      /supabase status --workdir "\$\{WORK_DIR\}" -o env >"\$\{ENV_FILE\}" 2>>"\$\{START_LOG\}"/,
    );
    expect(stackLauncher).toContain(
      "printf 'export CSF_PROFILE_CLAIM_SECRET=%q",
    );
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

  test("masks isolated credentials before exporting them to later CI steps", () => {
    const ciWorkflow = readFileSync(
      join(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );
    const firstMask = ciWorkflow.indexOf("printf '::add-mask::%s");
    const firstEnvironmentExport = ciWorkflow.indexOf(
      '>> "${GITHUB_ENV}"',
    );
    const firstHealthProbe = ciWorkflow.indexOf(
      "node scripts/local-dev/dv-local-env.mjs --health",
    );
    const maskCaseStart = ciWorkflow.indexOf('case "${key}" in');
    const maskCaseEnd = ciWorkflow.indexOf("esac", maskCaseStart);
    const maskLoopEnd = ciWorkflow.indexOf("\n          done", maskCaseEnd);
    const maskCase = ciWorkflow.slice(maskCaseStart, maskCaseEnd);

    expect(firstMask).toBeGreaterThan(-1);
    expect(firstEnvironmentExport).toBeGreaterThan(firstMask);
    expect(maskLoopEnd).toBeGreaterThan(maskCaseEnd);
    expect(firstHealthProbe).toBeGreaterThan(maskLoopEnd);
    expect(maskCaseStart).toBeGreaterThan(-1);
    expect(maskCaseEnd).toBeGreaterThan(maskCaseStart);
    expect(ciWorkflow).toContain(
      '"${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-DvTest!"',
    );
    expect(ciWorkflow).toContain(
      '"${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-CsfTest!"',
    );
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
    const root = process.cwd();
    const ciWorkflow = readFileSync(
      join(root, ".github/workflows/ci.yml"),
      "utf8",
    );
    const playwrightConfig = readFileSync(
      join(root, "playwright.csf.config.ts"),
      "utf8",
    );
    const uploadStep = ciWorkflow.indexOf(
      "uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    const traceValidationStep = ciWorkflow.indexOf(
      "- name: Validate retained CSF browser traces",
    );
    const traceValidationSection = ciWorkflow.slice(
      traceValidationStep,
      uploadStep,
    );
    const teardownStep = ciWorkflow.indexOf(
      "- name: Stop isolated Let’s Assist Supabase",
    );
    const uploadSection = ciWorkflow.slice(
      ciWorkflow.lastIndexOf("- name: Upload CSF browser evidence", uploadStep),
      teardownStep,
    );

    expect(ciWorkflow).toContain(
      "CSF_E2E_RUN_ID: ci-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(playwrightConfig).toContain(
      'process.env.CSF_E2E_RUN_ID ?? "playwright-local"',
    );
    expect(ciWorkflow).toContain(
      "path: artifacts/dvhs-csf-e2e/${{ env.CSF_E2E_RUN_ID }}/playwright/",
    );
    expect(ciWorkflow).toContain("if-no-files-found: warn");
    expect(ciWorkflow).toContain("retention-days: 7");
    expect(ciWorkflow).toContain("include-hidden-files: false");
    expect(ciWorkflow).toContain("unzip -tq");
    expect(ciWorkflow).toContain("invalid_trace=1");
    expect(ciWorkflow).toContain('exit "${invalid_trace}"');
    expect(traceValidationStep).toBeGreaterThan(-1);
    expect(traceValidationStep).toBeLessThan(uploadStep);
    expect(traceValidationSection).toContain("if: ${{ always() }}");
    expect(uploadSection).toContain("if: ${{ always() }}");
    expect(uploadStep).toBeGreaterThan(-1);
    expect(teardownStep).toBeGreaterThan(uploadStep);
  });
});
