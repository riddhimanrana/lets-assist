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
  test("uses four ordered guarded deployments and restores unknown outcomes", () => {
    const options = [
      "- workbook_refresh",
      "- import_commit",
      "- communications",
      "- scheduled_post_publisher",
    ];
    let optionIndex = -1;
    for (const option of options) {
      const nextIndex = productionWorkerEnableWorkflow.indexOf(option);
      expect(nextIndex).toBeGreaterThan(optionIndex);
      optionIndex = nextIndex;
    }
    expect(productionWorkerEnableWorkflow).toContain("environment: production");
    expect(productionWorkerEnableWorkflow).toContain(
      "group: production-schema-deployment",
    );
    expect(productionWorkerEnableWorkflow).toContain("queue: max");
    expect(productionWorkerEnableWorkflow).not.toContain(
      "group: production-csf-worker-enablement",
    );
    expect(productionWorkerEnableWorkflow).toContain(
      "github.ref == 'refs/heads/main'",
    );
    expect(productionWorkerEnableWorkflow).toContain(
      "enable-csf-worker:${WORKER}:${GITHUB_SHA}",
    );
    expect(productionWorkerEnableWorkflow).toContain("before=disabled");
    expect(productionWorkerEnableWorkflow).toContain("before=workbook_refresh");
    expect(productionWorkerEnableWorkflow).toContain("before=import_commit");
    expect(productionWorkerEnableWorkflow).toContain("before=communications");
    expect(
      productionWorkerEnableWorkflow.match(
        /bunx vercel@59\.3\.0 build --prod/gu,
      ) ?? [],
    ).toHaveLength(1);

    const priorPosture = productionWorkerEnableWorkflow.indexOf(
      "Verify the prior public worker posture",
    );
    const envUpdate = productionWorkerEnableWorkflow.indexOf(
      "Enable the selected Production environment flag",
    );
    const stagedPosture = productionWorkerEnableWorkflow.indexOf(
      "Verify staged worker posture",
    );
    const promote = productionWorkerEnableWorkflow.indexOf(
      "Promote the staged worker deployment",
    );
    const operation = productionWorkerEnableWorkflow.indexOf(
      "Verify worker promotion reached a terminal state",
    );
    const alias = productionWorkerEnableWorkflow.indexOf(
      "Verify the Production alias",
    );
    const publicPostcondition = productionWorkerEnableWorkflow.indexOf(
      "Verify the public worker postcondition",
    );
    const recovery = productionWorkerEnableWorkflow.indexOf(
      "Restore the prior worker deployment after an incomplete transition",
    );
    const result = productionWorkerEnableWorkflow.indexOf(
      "Require a settled worker transition",
    );
    expect(priorPosture).toBeGreaterThanOrEqual(0);
    expect(envUpdate).toBeGreaterThan(priorPosture);
    expect(stagedPosture).toBeGreaterThan(envUpdate);
    expect(promote).toBeGreaterThan(stagedPosture);
    expect(operation).toBeGreaterThan(promote);
    expect(alias).toBeGreaterThan(operation);
    expect(publicPostcondition).toBeGreaterThan(alias);
    expect(recovery).toBeGreaterThan(publicPostcondition);
    expect(result).toBeGreaterThan(recovery);

    for (const guard of [
      "steps.enable_config.outputs.cli_exit != '0'",
      "steps.promotion_operation.outcome != 'success'",
      "steps.verify_alias.outcome != 'success'",
      "steps.verify_public.outcome != 'success'",
    ]) {
      expect(productionWorkerEnableWorkflow).toContain(guard);
    }
    expect(productionWorkerEnableWorkflow).toContain('promote_exit="$?"');
    expect(productionWorkerEnableWorkflow).toContain("--value false");
    expect(productionWorkerEnableWorkflow).toContain(
      'promote "${PREVIOUS_DEPLOYMENT_ID}"',
    );
    expect(
      productionWorkerEnableWorkflow.match(
        /scripts\/production\/verify-vercel-alias\.sh/gu,
      ) ?? [],
    ).toHaveLength(2);
    expect(
      productionWorkerEnableWorkflow.match(
        /scripts\/production\/verify-vercel-alias-operation\.sh/gu,
      ) ?? [],
    ).toHaveLength(2);
    expect(
      productionWorkerEnableWorkflow.match(/Cache-Control: no-cache/gu) ?? [],
    ).toHaveLength(3);
    expect(
      productionWorkerEnableWorkflow.match(
        /scripts\/production\/verify-csf-worker-posture\.mjs/gu,
      ) ?? [],
    ).toHaveLength(4);
    expect(productionWorkerEnableWorkflow).toContain(
      "The worker transition did not settle. The prior public posture was restored and verified.",
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
