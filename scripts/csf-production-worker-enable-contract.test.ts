import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const productionWorkerEnableWorkflow = readFileSync(
  join(repositoryRoot, ".github/workflows/enable-production-csf-worker.yml"),
  "utf8",
);
const productionCutoverRunbook = readFileSync(
  join(repositoryRoot, "docs/development/production-cutover-runbook.md"),
  "utf8",
);
const productionWorkerPostureVerifierPath = join(
  repositoryRoot,
  "scripts/production/verify-csf-worker-posture.mjs",
);
const productionWorkerPostureVerifier = readFileSync(
  productionWorkerPostureVerifierPath,
  "utf8",
);

describe("CSF Production worker enablement", () => {
  test("uses release-bound runtime transitions without deployments", () => {
    for (const worker of [
      "workbook_refresh",
      "import_commit",
      "communications",
      "scheduled_post_publisher",
    ]) {
      expect(productionWorkerEnableWorkflow).toContain(`- ${worker}`);
    }
    expect(productionWorkerEnableWorkflow).toContain("environment: production");
    expect(productionWorkerEnableWorkflow).toContain(
      "group: production-schema-deployment",
    );
    expect(productionWorkerEnableWorkflow).toContain("queue: max");
    expect(productionWorkerEnableWorkflow).toContain(
      "github.ref == 'refs/heads/main'",
    );
    expect(productionWorkerEnableWorkflow).toContain(
      "git merge-base --is-ancestor",
    );
    expect(productionWorkerEnableWorkflow).toContain(
      "scripts/production/runtime-worker-transition.mjs",
    );
    expect(productionWorkerEnableWorkflow).toContain("SUPABASE_ACCESS_TOKEN:");
    expect(productionWorkerEnableWorkflow).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
    expect(productionWorkerEnableWorkflow).toContain("worker-transition.json");
    expect(productionWorkerEnableWorkflow).toContain("enabled:");
    expect(productionWorkerEnableWorkflow).not.toMatch(
      /vercel@|VERCEL_TOKEN|--prebuilt|env update|promote \$/u,
    );
    expect(productionCutoverRunbook).toContain(
      "Dispatch `enable-production-csf-worker.yml` four times",
    );
  });

  test("the posture verifier accepts one exact stage and rejects a skipped stage", () => {
    const sha = "a".repeat(40);
    const payload = (details: Record<string, boolean>) =>
      JSON.stringify({
        version: sha,
        environment: "production",
        deep: false,
        checks: [{ name: "workers", details }],
      });
    const exact = spawnSync(
      process.execPath,
      [productionWorkerPostureVerifierPath],
      {
        env: {
          ...process.env,
          EXPECTED_CSF_WORKER_STAGE: "import_commit",
          EXPECTED_RELEASE_SHA: sha,
        },
        input: payload({
          csfWorkbookRefresh: true,
          csfImportCommit: true,
          csfCommunications: false,
          csfScheduledPostPublisher: false,
        }),
        encoding: "utf8",
      },
    );
    expect(exact.status).toBe(0);
    expect(exact.stdout).toContain(
      "Production CSF worker posture verified at import_commit.",
    );

    const skipped = spawnSync(
      process.execPath,
      [productionWorkerPostureVerifierPath],
      {
        env: {
          ...process.env,
          EXPECTED_CSF_WORKER_STAGE: "import_commit",
          EXPECTED_RELEASE_SHA: sha,
        },
        input: payload({
          csfWorkbookRefresh: true,
          csfImportCommit: true,
          csfCommunications: true,
          csfScheduledPostPublisher: false,
        }),
        encoding: "utf8",
      },
    );
    expect(skipped.status).not.toBe(0);
    expect(skipped.stderr).not.toContain(sha);
    expect(productionWorkerPostureVerifier).not.toContain(
      "process.env.VERCEL_TOKEN",
    );
  });
});
