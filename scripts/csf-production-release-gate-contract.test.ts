import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const ciWorkflow = readFileSync(
  join(repositoryRoot, ".github/workflows/ci.yml"),
  "utf8",
);
const deploymentWorkflow = readFileSync(
  join(repositoryRoot, ".github/workflows/deploy-schema.yml"),
  "utf8",
);
const hostedDevelopmentWorkflow = readFileSync(
  join(
    repositoryRoot,
    ".github/workflows/csf-hosted-development-acceptance.yml",
  ),
  "utf8",
);
const productionRecoveryWorkflow = readFileSync(
  join(repositoryRoot, ".github/workflows/production-release-recovery.yml"),
  "utf8",
);
const supabaseDeploymentGuide = readFileSync(
  join(repositoryRoot, "docs/development/supabase-deployment.md"),
  "utf8",
);
const nextConfig = readFileSync(join(repositoryRoot, "next.config.ts"), "utf8");
const statusRoute = readFileSync(
  join(repositoryRoot, "app/api/status/route.ts"),
  "utf8",
);
const productionProjectVerifier = readFileSync(
  join(repositoryRoot, "scripts/production/verify-vercel-project.sh"),
  "utf8",
);
const productionAliasVerifier = readFileSync(
  join(repositoryRoot, "scripts/production/verify-vercel-alias.sh"),
  "utf8",
);
const vercelAliasOperationVerifier = readFileSync(
  join(repositoryRoot, "scripts/production/verify-vercel-alias-operation.sh"),
  "utf8",
);
const applicationWriteBlock = readFileSync(
  join(repositoryRoot, "scripts/production/set-application-write-block.sh"),
  "utf8",
);
const postgrestWriteBlockVerifier = readFileSync(
  join(repositoryRoot, "scripts/production/verify-postgrest-write-block.sh"),
  "utf8",
);
const csfTargetSchemaVerifier = readFileSync(
  join(repositoryRoot, "scripts/production/verify-csf-target-schema.sql"),
  "utf8",
);
const maintenanceOutputConfig = readFileSync(
  join(repositoryRoot, "scripts/production/maintenance-output/config.json"),
  "utf8",
);

function jobBlock(source: string, name: string) {
  const marker = `\n  ${name}:\n`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${name} job is missing`);
  const body = source.slice(start + marker.length);
  const nextJob = /^ {2}[A-Za-z][A-Za-z0-9_-]*:\s*$/mu.exec(body);
  return nextJob ? body.slice(0, nextJob.index) : body;
}

function occurrenceIndex(source: string, marker: string, occurrence: number) {
  let fromIndex = 0;
  let index = -1;
  for (let count = 0; count < occurrence; count += 1) {
    index = source.indexOf(marker, fromIndex);
    if (index === -1) return -1;
    fromIndex = index + marker.length;
  }
  return index;
}

function stepBlock(source: string, name: string) {
  const marker = `\n      - name: ${name}\n`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${name} step is missing`);
  const body = source.slice(start + marker.length);
  const nextStep = /^ {6}- (?:name:|uses:)/mu.exec(body);
  return nextStep ? body.slice(0, nextStep.index) : body;
}

function stepTimeout(source: string, name: string) {
  const match = /^\s*timeout-minutes:\s*(\d+)\s*$/mu.exec(
    stepBlock(source, name),
  );
  if (!match) throw new Error(`${name} step has no timeout`);
  return Number(match[1]);
}

describe("CSF Production release preflight", () => {
  test("pins release workflow actions to reviewed commits", () => {
    const pins = {
      "actions/checkout": "8e8c483db84b4bee98b60c0593521ed34d9990e8 # v6.0.1",
      "oven-sh/setup-bun": "0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
      "supabase/setup-cli": "3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf # v2.1.1",
    } as const;
    const workflows = [
      {
        source: ciWorkflow,
        counts: {
          "actions/checkout": 4,
          "oven-sh/setup-bun": 2,
          "supabase/setup-cli": 1,
        },
      },
      {
        source: deploymentWorkflow,
        counts: {
          "actions/checkout": 4,
          "oven-sh/setup-bun": 3,
          "supabase/setup-cli": 2,
        },
      },
      {
        source: hostedDevelopmentWorkflow,
        counts: {
          "actions/checkout": 2,
          "oven-sh/setup-bun": 1,
          "supabase/setup-cli": 0,
        },
      },
      {
        source: productionRecoveryWorkflow,
        counts: {
          "actions/checkout": 1,
          "oven-sh/setup-bun": 1,
          "supabase/setup-cli": 1,
        },
      },
    ];

    for (const workflow of workflows) {
      for (const action of Object.keys(pins) as Array<keyof typeof pins>) {
        const references = workflow.source
          .split("\n")
          .filter((line) => line.includes(`uses: ${action}@`));
        expect(references).toHaveLength(workflow.counts[action]);
        for (const reference of references) {
          expect(reference.trim().replace(/^- /u, "")).toBe(
            `uses: ${action}@${pins[action]}`,
          );
        }
      }
    }

    expect(deploymentWorkflow).toContain(
      `uses: supabase/setup-cli@${pins["supabase/setup-cli"]}`,
    );
    expect(hostedDevelopmentWorkflow).toContain(
      `uses: actions/checkout@${pins["actions/checkout"]}`,
    );
    expect(hostedDevelopmentWorkflow).toContain(
      `uses: oven-sh/setup-bun@${pins["oven-sh/setup-bun"]}`,
    );
    expect(deploymentWorkflow).toContain(
      "uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2",
    );
    expect(productionRecoveryWorkflow).toContain(
      "uses: actions/download-artifact@634f93cb2916e3fdff6788551b99b062d0335ce0 # v5.0.0",
    );
  });

  test("the confirmed Production workflow calls the exact reusable CI gates", () => {
    const preflight = jobBlock(deploymentWorkflow, "csf-release-gates");

    expect(ciWorkflow).toContain("  workflow_call:");
    expect(preflight).toContain("uses: ./.github/workflows/ci.yml");
    expect(preflight).toContain("secrets: inherit");
  });

  test("deployment requires the reusable gate and retains action-time confirmation", () => {
    const deployment = jobBlock(deploymentWorkflow, "deploy-to-production");

    expect(deployment).toContain("hosted-development-acceptance,");
    expect(deployment).toContain("production-recovery-gate,");
    expect(deployment).toContain("github.ref == 'refs/heads/main'");
    expect(deployment).toContain(
      "inputs.production_confirmation == 'deploy-production:fotdmeakexgrkronxlof'",
    );
    expect(deployment).toContain("environment: production");
    expect(deployment).toContain("scripts/production/verify-vercel-project.sh");
    expect(deployment).toContain("scripts/production/verify-vercel-alias.sh");
  });

  test("refuses Production cutover while Rolling Releases are configured or active", () => {
    expect(productionProjectVerifier).toContain(
      "/rolling-release/config?teamId=${VERCEL_TEAM_ID}",
    );
    expect(productionProjectVerifier).toContain(
      "/rolling-release?teamId=${VERCEL_TEAM_ID}",
    );
    expect(productionProjectVerifier).toContain("'.rollingRelease == null'");
    expect(productionProjectVerifier).toContain(
      '.rollingRelease.state == "ABORTED"',
    );
    expect(productionProjectVerifier).toContain(
      '.rollingRelease.state == "COMPLETE"',
    );
    expect(productionProjectVerifier).toContain(
      "Vercel Rolling Releases must be disabled",
    );
    expect(productionProjectVerifier).toContain(
      "An active Vercel Rolling Release blocks",
    );
    expect(productionProjectVerifier).toContain(
      ".autoExposeSystemEnvs == true",
    );
  });

  test("builds once and keeps Production write-blocked through final alias proof", () => {
    const deployment = jobBlock(deploymentWorkflow, "deploy-to-production");
    const prebuild = deployment.indexOf("vercel@59.3.0 build --prod");
    const maintenanceDeploy = occurrenceIndex(
      deployment,
      "vercel@59.3.0 deploy \\",
      1,
    );
    const enableWriteBlock = deployment.indexOf(
      "set-application-write-block.sh enable",
    );
    const maintenancePromote = occurrenceIndex(
      deployment,
      "vercel@59.3.0 promote",
      1,
    );
    const maintenanceAliasVerification = occurrenceIndex(
      deployment,
      "scripts/production/verify-vercel-alias.sh",
      1,
    );
    const schemaPush = deployment.indexOf("supabase db push --linked --yes");
    const schemaParity = deployment.indexOf(
      "verify-supabase-migration-parity.mjs",
    );
    const schemaCompatibility = deployment.indexOf(
      "scripts/production/verify-csf-target-schema.sql",
    );
    const stagedDeploy = occurrenceIndex(
      deployment,
      "vercel@59.3.0 deploy \\",
      2,
    );
    const stagedIdentity = deployment.indexOf(
      "vercel@59.3.0 curl '/api/status?deep=0'",
    );
    const recoveryManifest = deployment.indexOf(
      "production-release-recovery.json",
    );
    const smoke = deployment.indexOf("vercel@59.3.0 curl '/api/status?deep=1'");
    const promote = occurrenceIndex(deployment, "vercel@59.3.0 promote", 2);
    const promotionFence = deployment.indexOf(
      "Verify application promotion reached a terminal state",
    );
    const aliasVerification = occurrenceIndex(
      deployment,
      "scripts/production/verify-vercel-alias.sh",
      2,
    );
    const disableWriteBlock = deployment.indexOf(
      "set-application-write-block.sh disable",
    );

    for (const index of [
      prebuild,
      maintenanceDeploy,
      enableWriteBlock,
      maintenancePromote,
      maintenanceAliasVerification,
      schemaPush,
      schemaParity,
      schemaCompatibility,
      stagedDeploy,
      stagedIdentity,
      recoveryManifest,
      smoke,
      promote,
      promotionFence,
      aliasVerification,
      disableWriteBlock,
    ]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(prebuild).toBeLessThan(maintenanceDeploy);
    expect(maintenanceDeploy).toBeLessThan(stagedDeploy);
    expect(stagedDeploy).toBeLessThan(stagedIdentity);
    expect(stagedIdentity).toBeLessThan(recoveryManifest);
    expect(recoveryManifest).toBeLessThan(enableWriteBlock);
    expect(enableWriteBlock).toBeLessThan(maintenancePromote);
    expect(maintenancePromote).toBeLessThan(maintenanceAliasVerification);
    expect(maintenanceAliasVerification).toBeLessThan(schemaPush);
    expect(schemaPush).toBeLessThan(schemaParity);
    expect(schemaParity).toBeLessThan(schemaCompatibility);
    expect(schemaCompatibility).toBeLessThan(smoke);
    expect(smoke).toBeLessThan(promote);
    expect(promote).toBeLessThan(promotionFence);
    expect(promotionFence).toBeLessThan(aliasVerification);
    expect(aliasVerification).toBeLessThan(disableWriteBlock);
    expect(
      deployment.match(/vercel@59\.3\.0 build --prod/gu) ?? [],
    ).toHaveLength(1);
    expect(deployment).toContain("timeout-minutes: 120");
    expect(deployment).toContain("--standalone");
    expect(deployment).toContain("--prebuilt");
    expect(deployment).toContain("--skip-domain");
    expect(deployment).toContain("--timeout=10m");
    expect(deployment).toContain("VERCEL_ENV: production");
    expect(deployment).toContain("VERCEL_GIT_COMMIT_SHA: ${{ github.sha }}");
    expect(nextConfig).toContain("LETS_ASSIST_BUILD_SHA: requestedBuildSha");
    expect(nextConfig).toContain("/^[0-9a-f]{40}$/u.test(requestedBuildSha)");
    expect(
      statusRoute.indexOf("process.env.LETS_ASSIST_BUILD_SHA"),
    ).toBeLessThan(statusRoute.indexOf("process.env.VERCEL_GIT_COMMIT_SHA"));
    expect(deployment).toContain("--connect-timeout 10");
    expect(deployment).toContain("--max-time 30");
    expect(deployment).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
    );
    expect(deployment).toContain(
      '--protection-bypass="${VERCEL_AUTOMATION_BYPASS_SECRET}"',
    );
    expect(deployment).toContain('promote_exit="$?"');
    expect(deployment).toContain(
      "the exact alias postcondition will determine the release result",
    );
    expect(deployment).toContain('.name == "environment"');
    expect(deployment).toContain('.name == "database"');
    expect(deployment).toContain('.name == "tables-deep"');
    expect(deployment).toContain('jq -e --arg sha "${GITHUB_SHA}"');
    expect(deployment).toContain(".version == $sha");
    expect(deployment).toContain(
      "scripts/production/verify-postgrest-write-block.sh",
    );
    expect(deployment).toContain("always() &&");
    expect(deployment).toContain(
      "steps.write_block_recovery.outputs.armed == 'true' &&",
    );
    expect(deployment).toContain(
      "steps.disable_write_block.outcome != 'success'",
    );
    const recovery = deployment.slice(
      deployment.indexOf(
        "Retain Production write block after incomplete release",
      ),
    );
    expect(recovery).toContain("set-application-write-block.sh enable");
    expect(recovery).toContain("set -uo pipefail");
    expect(recovery).toContain(
      "timeout 45s bash scripts/production/set-application-write-block.sh enable",
    );
    expect(recovery).toContain(
      "timeout 25s bash scripts/production/verify-postgrest-write-block.sh",
    );
    expect(recovery).not.toContain("vercel@59.3.0 promote");
    expect(recovery).not.toContain("vercel@59.3.0 rollback");
    expect(recovery).not.toContain("verify-vercel-alias-operation.sh");
    expect(recovery).not.toContain("verify-vercel-alias.sh");
    expect(recovery).toContain("postcondition_failures=0");
    expect(recovery).toContain(
      "postcondition_failures=$((postcondition_failures + 1))",
    );
    expect(recovery).toContain('if [[ "${postcondition_failures}" -ne 0 ]]');
    const recoveryWriteAttempt = recovery.indexOf(
      "set-application-write-block.sh enable",
    );
    const recoveryWriteProof = recovery.indexOf(
      "scripts/production/verify-postgrest-write-block.sh",
    );
    expect(recoveryWriteAttempt).toBeLessThan(recoveryWriteProof);
  });

  test("reserves a bounded recovery window before Production writes", () => {
    const deployment = jobBlock(deploymentWorkflow, "deploy-to-production");
    const priorRecovery = jobBlock(
      deploymentWorkflow,
      "production-recovery-gate",
    );
    const startMarker = "\n      - name: Record Production job start\n";
    const armMarker = "\n      - name: Arm Production maintenance recovery\n";
    const recoveryMarker =
      "\n      - name: Retain Production write block after incomplete release\n";
    const startClock = deployment.indexOf(startMarker);
    const checkout = deployment.indexOf("uses: actions/checkout@");
    const arm = deployment.indexOf(armMarker);
    const recovery = deployment.indexOf(recoveryMarker);
    const normalWindowSteps = [
      "Block Production application writes",
      "Prove a fresh Production application write is blocked",
      "Promote maintenance page to Production",
      "Verify Production maintenance alias",
      "Push schema to production",
      "Verify production schema deployment",
      "Verify CSF target schema compatibility",
      "Smoke the staged Production application",
      "Promote the staged application to Production",
      "Verify application promotion reached a terminal state",
      "Verify Production alias promotion",
      "Open Production application writes",
    ] as const;

    expect(startClock).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeGreaterThanOrEqual(0);
    expect(arm).toBeGreaterThan(checkout);
    expect(recovery).toBeGreaterThan(arm);
    expect(startClock).toBeLessThan(checkout);
    expect(stepTimeout(deployment, "Record Production job start")).toBe(1);
    const armStep = stepBlock(
      deployment,
      "Arm Production maintenance recovery",
    );
    expect(stepTimeout(deployment, "Arm Production maintenance recovery")).toBe(
      1,
    );
    expect(armStep).toContain("elapsed_seconds > 2100");
    expect(armStep).toContain("More than 35 minutes elapsed");
    const recoveryCredentials = stepBlock(
      deployment,
      "Require Production recovery credentials",
    );
    expect(
      stepTimeout(deployment, "Require Production recovery credentials"),
    ).toBe(1);
    expect(recoveryCredentials).toContain(
      "SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}",
    );
    expect(recoveryCredentials).toContain(
      "PRODUCTION_READONLY_URL: ${{ secrets.PRODUCTION_READONLY_URL }}",
    );
    expect(
      deployment.indexOf("Require Production recovery credentials"),
    ).toBeLessThan(arm);
    expect(supabaseDeploymentGuide).toContain("- `SUPABASE_SECRET_KEY`");
    expect(supabaseDeploymentGuide).toContain("- `PRODUCTION_READONLY_URL`");
    const priorRecoveryStep = stepBlock(
      priorRecovery,
      "Refuse re-runs and unresolved Production recovery",
    );
    expect(
      stepTimeout(
        priorRecovery,
        "Refuse re-runs and unresolved Production recovery",
      ),
    ).toBe(5);
    expect(priorRecovery).toContain('"${GITHUB_RUN_ATTEMPT}" != "1"');
    expect(priorRecovery).toContain("Production release re-runs are disabled");
    expect(priorRecoveryStep).toContain("gh api --paginate --slurp");
    expect(priorRecoveryStep).not.toContain("status=completed");
    expect(priorRecoveryStep).toContain('"${source_status}" != "completed"');
    expect(priorRecoveryStep).toContain(
      '"${source_run_id}" == "${GITHUB_RUN_ID}"',
    );
    expect(priorRecoveryStep).toContain("attempts/${source_run_attempt}");
    expect(priorRecoveryStep).toContain(
      "production-release-recovery/${source_run_id}/${source_run_attempt}",
    );
    expect(priorRecoveryStep.indexOf("recovery_context=")).toBeLessThan(
      priorRecoveryStep.indexOf("artifact_name="),
    );
    expect(priorRecoveryStep).toContain(
      'if [[ "${trusted_recovery}" == "true" ]]',
    );
    expect(priorRecoveryStep).toContain(
      "has no trusted successful recovery receipt",
    );
    expect(priorRecoveryStep).toContain(
      '.path == ".github/workflows/production-release-recovery.yml"',
    );
    expect(priorRecoveryStep).toContain('.conclusion == "success"');
    expect(priorRecoveryStep).toContain(
      '.name == "Deploy Schema to Production"',
    );
    expect(priorRecoveryStep).toContain('"${write_block_step_count}" == "0"');
    expect(priorRecoveryStep).not.toContain("VERCEL_TOKEN");
    expect(priorRecoveryStep).not.toContain("SUPABASE_ACCESS_TOKEN");
    for (const job of [
      "csf-release-gates",
      "hosted-development-acceptance",
      "validate-migrations",
    ]) {
      expect(jobBlock(deploymentWorkflow, job)).toContain(
        "needs: production-recovery-gate",
      );
    }

    const protectedWindow = deployment.slice(arm, recovery);
    const protectedStepNames = [
      ...protectedWindow.matchAll(/^ {6}- name: (.+)$/gmu),
    ].map((match) => match[1]);
    expect(protectedStepNames).toEqual([
      "Arm Production maintenance recovery",
      ...normalWindowSteps,
    ]);
    const normalTimeoutTotal = normalWindowSteps.reduce(
      (total, name) => total + stepTimeout(deployment, name),
      0,
    );
    expect(normalTimeoutTotal).toBeLessThanOrEqual(65);
    expect(
      stepTimeout(
        deployment,
        "Retain Production write block after incomplete release",
      ),
    ).toBeLessThanOrEqual(4);
    const inlineRecovery = stepBlock(
      deployment,
      "Retain Production write block after incomplete release",
    );
    expect(inlineRecovery).toContain(
      "steps.enable_write_block.outcome != 'skipped'",
    );
  });

  test("durably reconciles a cancelled release from an exact recovery manifest", () => {
    const classifier = jobBlock(productionRecoveryWorkflow, "classify-source");
    const recovery = jobBlock(
      productionRecoveryWorkflow,
      "reconcile-production",
    );
    const guard = recovery.indexOf("set-application-write-block.sh enable");
    const guardProof = recovery.indexOf("verify-postgrest-write-block.sh");
    const providerProof = recovery.indexOf("verify-vercel-project.sh");
    const restore = recovery.indexOf(
      "Restore and prove exact Production maintenance deployment",
    );

    expect(productionRecoveryWorkflow).toContain("workflow_run:");
    expect(productionRecoveryWorkflow).toContain(
      'workflows: ["Deploy Production Release"]',
    );
    expect(productionRecoveryWorkflow).toContain("types: [completed]");
    expect(productionRecoveryWorkflow).toContain(
      "group: production-schema-deployment",
    );
    expect(deploymentWorkflow).toContain("queue: max");
    expect(productionRecoveryWorkflow).toContain("queue: max");
    expect(recovery).toContain("environment: production");
    expect(recovery).toContain("timeout-minutes: 60");
    for (const identity of [
      "github.event.workflow_run.conclusion != 'success'",
      "github.event.workflow_run.event == 'workflow_dispatch'",
      "github.event.workflow_run.head_branch == 'main'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "github.event.workflow_run.repository.full_name == github.repository",
      '.name == "Deploy Production Release"',
      '.path == ".github/workflows/deploy-schema.yml"',
      ".head_sha == $sha",
      '.status == "completed"',
    ]) {
      expect(productionRecoveryWorkflow).toContain(identity);
    }
    expect(classifier).toContain(
      "production-release-recovery-${SOURCE_RUN_ID}-${SOURCE_RUN_ATTEMPT}",
    );
    expect(classifier).toContain(
      "actions/runs/${SOURCE_RUN_ID}/attempts/${SOURCE_RUN_ATTEMPT}",
    );
    expect(classifier).toContain("(.run_attempt | tostring) == $run_attempt");
    expect(
      productionRecoveryWorkflow.match(
        /production-release-recovery\/\$\{SOURCE_RUN_ID\}\/\$\{SOURCE_RUN_ATTEMPT\}/gu,
      ) ?? [],
    ).toHaveLength(3);
    expect(recovery).toContain(
      "${{ runner.temp }}/production-release-recovery",
    );
    expect(recovery).toContain("run-id: ${{ github.event.workflow_run.id }}");
    expect(recovery).toContain("ref: ${{ github.sha }}");
    expect(recovery).not.toContain(
      "ref: ${{ github.event.workflow_run.head_sha }}",
    );
    expect(recovery).toContain(
      'test "$(git rev-parse HEAD)" = "${RECOVERY_WORKFLOW_SHA}"',
    );
    expect(recovery).toContain("persist-credentials: false");
    expect(classifier).toContain('write_block_conclusion}" == "skipped"');
    expect(classifier).toContain('write_open_conclusion}" == "success"');
    expect(classifier).toContain(
      "stopped before the Production write block, so recovery is not required",
    );
    expect(classifier.indexOf("source_jobs=")).toBeLessThan(
      classifier.indexOf("artifact_count="),
    );
    expect(classifier).toContain(
      "An armed or uncertain Production release requires one unexpired recovery manifest",
    );
    expect(recovery).toContain("needs: classify-source");
    expect(recovery).toContain(
      "if: needs.classify-source.outputs.required == 'true'",
    );
    expect(recovery).toContain(".meta[$metadata_key]");
    expect(recovery).toContain('metadata_key="productionReleaseSha"');
    expect(recovery).toContain('metadata_key="productionMaintenanceForSha"');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guardProof).toBeGreaterThan(guard);
    expect(providerProof).toBeGreaterThan(guardProof);
    expect(restore).toBeGreaterThan(providerProof);

    const restoreStep = stepBlock(
      productionRecoveryWorkflow,
      "Restore and prove exact Production maintenance deployment",
    );
    const exactAppFence = restoreStep.indexOf(
      'wait_for_exact_operation promote "${APPLICATION_DEPLOYMENT_ID}"',
    );
    const rollback = restoreStep.indexOf(
      "request_maintenance_operation rollback",
      exactAppFence,
    );
    expect(exactAppFence).toBeGreaterThanOrEqual(0);
    expect(rollback).toBeGreaterThan(exactAppFence);
    expect(restoreStep).toContain(
      'APPLICATION_PROMOTION_CONCLUSION}" != "skipped"',
    );
    expect(restoreStep).toContain(
      'wait_for_exact_operation "${current_operation}" "${MAINTENANCE_DEPLOYMENT_ID}"',
    );
    expect(restoreStep.indexOf("project_payload=")).toBeLessThan(
      restoreStep.indexOf("if maintenance_alias_is_current"),
    );
    expect(restoreStep).toContain(
      '"${current_deployment}" == "${MAINTENANCE_DEPLOYMENT_ID}"',
    );
    expect(restoreStep).toContain(
      '"${current_deployment}" == "${APPLICATION_DEPLOYMENT_ID}"',
    );
    expect(restoreStep).toContain('"${exact_operation_status}" == "succeeded"');
    const terminalAppSuccess = restoreStep.indexOf(
      'if [[ "${exact_operation_status}" == "succeeded" ]]',
      exactAppFence,
    );
    expect(terminalAppSuccess).toBeGreaterThan(exactAppFence);
    expect(
      restoreStep.indexOf(
        "request_maintenance_operation rollback",
        terminalAppSuccess,
      ),
    ).toBeGreaterThan(terminalAppSuccess);
    expect(restoreStep).toContain(
      "The source application promotion is not observable. Production remains write-blocked.",
    );
    expect(restoreStep).toContain(
      "The source maintenance promotion is not observable. Production remains write-blocked.",
    );
    expect(restoreStep).toContain("request_maintenance_operation promote");
    expect(restoreStep).toContain(
      'VERCEL_ALIAS_OPERATION_TIMEOUT_SECONDS: "600"',
    );
    expect(restoreStep).toContain("timeout 660s");
    expect(restoreStep).toContain("timeout 190s");
    expect(restoreStep).toContain("verify-vercel-alias.sh");
    expect(recovery).not.toContain("set-application-write-block.sh disable");
    expect(recovery).not.toContain("Open Production application writes");
    expect(
      stepTimeout(
        productionRecoveryWorkflow,
        "Restore and prove exact Production maintenance deployment",
      ),
    ).toBe(31);
  });

  test("runs the private preflight before maintenance or Production writes", () => {
    const deployment = jobBlock(deploymentWorkflow, "deploy-to-production");
    const preflight = deployment.indexOf(
      "scripts/production-cutover-preflight.sql",
    );
    const readonlyUrlBinding = deployment.indexOf("new URL(rawDatabaseUrl)");
    const dryRun = deployment.indexOf("supabase db push --linked --dry-run");
    const maintenanceDeploy = occurrenceIndex(
      deployment,
      "vercel@59.3.0 deploy \\",
      1,
    );
    const writeBlock = deployment.indexOf(
      "set-application-write-block.sh enable",
    );

    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(readonlyUrlBinding).toBeGreaterThanOrEqual(0);
    expect(dryRun).toBeGreaterThanOrEqual(0);
    expect(maintenanceDeploy).toBeGreaterThanOrEqual(0);
    expect(writeBlock).toBeGreaterThanOrEqual(0);
    expect(readonlyUrlBinding).toBeLessThan(preflight);
    expect(preflight).toBeLessThan(dryRun);
    expect(dryRun).toBeLessThan(maintenanceDeploy);
    expect(maintenanceDeploy).toBeLessThan(writeBlock);
    expect(deployment).toContain(
      "PRODUCTION_READONLY_URL: ${{ secrets.PRODUCTION_READONLY_URL }}",
    );
    expect(deployment).toContain(
      "EXPECTED_SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_ID }}",
    );
    expect(deployment).toContain(
      "hostname === `db.${expectedRef}.supabase.co`",
    );
    expect(deployment).toContain('hostname.endsWith(".pooler.supabase.com")');
    expect(deployment).toContain(
      "databaseUsername === `postgres.${expectedRef}`",
    );
    expect(deployment).toContain("decodeURIComponent(databaseUrl.username)");
    expect(deployment).toContain('databaseUrl.protocol === "postgres:"');
    expect(deployment).toContain('databaseUrl.protocol === "postgresql:"');
    expect(deployment).toContain('psql -X "${PRODUCTION_READONLY_URL}"');
    expect(deployment).toContain("-v ON_ERROR_STOP=1");
    expect(deployment).toContain('>"${preflight_log}" 2>&1');
    expect(deployment).toContain(
      "Production cutover preflight failed. Raw output was suppressed.",
    );
  });

  test("checks the CSF target schema without reading member data", () => {
    for (const relation of [
      "csf_class_workbooks",
      "csf_class_workbook_refresh_jobs",
      "csf_import_approval_batches",
      "csf_import_commit_queue",
      "csf_import_approval_batch_items",
      "csf_import_row_batches",
      "csf_import_row_batch_outcomes",
    ]) {
      expect(csfTargetSchemaVerifier).toContain(relation);
    }
    for (const signature of [
      "csf_queue_class_workbook_preparation",
      "csf_claim_class_workbook_refresh_job",
      "csf_queue_import_preview_batch",
      "csf_claim_import_commit_queue",
      "csf_finish_import_commit_queue",
      "csf_commit_import_row_batch",
    ]) {
      expect(csfTargetSchemaVerifier).toContain(signature);
    }
    expect(csfTargetSchemaVerifier).toContain(
      "This single statement reads catalog metadata only",
    );
    expect(csfTargetSchemaVerifier).toContain("relrowsecurity");
    expect(csfTargetSchemaVerifier).toContain("has_table_privilege");
    expect(csfTargetSchemaVerifier).toContain("has_function_privilege");
    expect(csfTargetSchemaVerifier).toContain(
      "csf_sheet_sources_cohort_organization_fkey",
    );
    expect(csfTargetSchemaVerifier).toContain(
      "csf_import_approval_batches_normalize_status",
    );
    expect(csfTargetSchemaVerifier).toContain(
      "csf_import_approval_batches_audit",
    );
    expect(csfTargetSchemaVerifier).toContain(
      "csf_import_approval_items_org_queue_idx",
    );
    expect(csfTargetSchemaVerifier).toContain(
      "ARRAY['organization_id', 'queue_id']::text[]",
    );
    expect(csfTargetSchemaVerifier).toContain("(queue_id IS NOT NULL)");
    expect(csfTargetSchemaVerifier).toContain("csf_register_class_workbook");
    expect(csfTargetSchemaVerifier).toContain("AS csf_target_schema_verified");
    expect(csfTargetSchemaVerifier).not.toMatch(/^\s*\\/mu);
    expect(csfTargetSchemaVerifier).not.toMatch(/\bFROM\s+plugin_data\./iu);
  });

  test("the maintenance cutover blocks fresh PostgREST writes without another build", () => {
    const maintenanceConfig = JSON.parse(maintenanceOutputConfig) as {
      version: number;
      crons: unknown[];
      routes: Array<{
        src?: string;
        dest?: string;
        status?: number;
        headers?: Record<string, string>;
      }>;
    };
    expect(maintenanceConfig).toMatchObject({
      version: 3,
      crons: [],
    });
    expect(maintenanceConfig.routes[0]).toMatchObject({
      src: "^/api(?:/.*)?$",
      dest: "/maintenance-api.json",
      status: 503,
      headers: {
        "Retry-After": "300",
        "Cache-Control": "no-store, max-age=0",
      },
    });
    expect(maintenanceConfig.routes.at(-1)).toMatchObject({
      dest: "/maintenance.html",
      status: 503,
      headers: {
        "Retry-After": "300",
        "Cache-Control": "no-store, max-age=0",
      },
    });
    expect(applicationWriteBlock).toContain(
      "ALTER ROLE authenticator SET default_transaction_read_only TO 'on'",
    );
    expect(applicationWriteBlock).toContain(
      "ALTER ROLE authenticator RESET default_transaction_read_only",
    );
    expect(applicationWriteBlock).toContain("array_agg(pid)");
    expect(applicationWriteBlock).toContain(
      "pg_terminate_backend(target.target_pid, 0)",
    );
    expect(applicationWriteBlock).toContain("pid = ANY (captured_pids)");
    expect(applicationWriteBlock).toContain("remaining_pids = 0");
    expect(applicationWriteBlock).toContain("interval '20 seconds'");
    expect(applicationWriteBlock).toContain("pg_sleep(0.1)");
    expect(applicationWriteBlock).not.toContain(", 5000)");
    expect(applicationWriteBlock.match(/timeout 60s/gu) ?? []).toHaveLength(1);
    expect(
      applicationWriteBlock.match(/run_linked_query "/gu) ?? [],
    ).toHaveLength(4);
    expect(postgrestWriteBlockVerifier).toContain(
      "id.eq.00000000-0000-0000-0000-000000000000,id.neq.00000000-0000-0000-0000-000000000000",
    );
    expect(postgrestWriteBlockVerifier).toContain('.code == "25006"');
    expect(postgrestWriteBlockVerifier).toContain("--connect-timeout 10");
    expect(postgrestWriteBlockVerifier).toContain("--max-time 20");
  });

  test("checkout does not leave a competing Git credential on the release job", () => {
    const deployment = jobBlock(deploymentWorkflow, "deploy-to-production");

    expect(deployment).toContain("persist-credentials: false");
  });

  test("binds the Production project and final alias to reviewed coordinates", () => {
    expect(productionProjectVerifier).toContain('.link.type == "github"');
    expect(productionProjectVerifier).toContain(".link.repoId");
    expect(productionProjectVerifier).toContain(
      '.link.productionBranch == "main"',
    );
    expect(productionProjectVerifier).toContain(".accountId == $team");
    expect(productionProjectVerifier).toContain("--connect-timeout 10");
    expect(productionProjectVerifier).toContain("--max-time 20");
    expect(productionAliasVerifier).toContain(
      'production_alias="lets-assist.com"',
    );
    expect(productionAliasVerifier).toContain(
      'resolved_deployment_id}" == "${PRODUCTION_DEPLOYMENT_ID}',
    );
    expect(productionAliasVerifier).toContain('.readyState == "READY"');
    expect(productionAliasVerifier).toContain('.target == "production"');
    expect(productionAliasVerifier).toContain(
      'verification_timeout_seconds="${VERCEL_ALIAS_VERIFY_TIMEOUT_SECONDS:-180}"',
    );
    expect(productionAliasVerifier).toContain(
      "verification_deadline=$((SECONDS + verification_timeout_seconds))",
    );
    expect(productionAliasVerifier).toContain(
      'connect_timeout_seconds="${VERCEL_ALIAS_CONNECT_TIMEOUT_SECONDS:-10}"',
    );
    expect(productionAliasVerifier).toContain(
      'http_timeout_seconds="${VERCEL_ALIAS_HTTP_TIMEOUT_SECONDS:-20}"',
    );
    expect(vercelAliasOperationVerifier).toContain(".lastAliasRequest.type");
    expect(vercelAliasOperationVerifier).toContain(
      ".lastAliasRequest.toDeploymentId",
    );
    expect(vercelAliasOperationVerifier).toContain(
      ".lastAliasRequest.jobStatus",
    );
    expect(vercelAliasOperationVerifier).toContain(
      "succeeded | failed | skipped",
    );
    expect(vercelAliasOperationVerifier).toContain("pending | in-progress");
  });

  test("Production requires the exact hosted Development tree and successful status", () => {
    const acceptance = jobBlock(
      deploymentWorkflow,
      "hosted-development-acceptance",
    );

    expect(deploymentWorkflow).toContain("hosted_development_sha:");
    expect(deploymentWorkflow).toContain("actions: read");
    expect(acceptance).toContain("git merge-base --is-ancestor");
    expect(acceptance).toContain('git rev-parse "${ACCEPTED_SHA}^{tree}"');
    expect(acceptance).toContain("git rev-parse 'HEAD^{tree}'");
    expect(acceptance).toContain(
      'select(.context == "csf-hosted-development-acceptance" and .creator.login == "github-actions[bot]")',
    );
    expect(acceptance).toContain("sort_by(.created_at) | last // {}");
    expect(acceptance).toContain('status_state}" != "success"');
    expect(acceptance).toContain('.creator.login == "github-actions[bot]"');
    expect(acceptance).toContain(
      'expected_run_prefix="https://github.com/${GITHUB_REPOSITORY}/actions/runs/"',
    );
    expect(acceptance).toContain("actions/runs/${run_id}");
    expect(acceptance).toContain(
      '.path == ".github/workflows/csf-hosted-development-acceptance.yml"',
    );
    expect(acceptance).toContain(".head_sha == $sha");
    expect(acceptance).toContain('.head_branch == "development"');
    expect(acceptance).toContain(".repository.full_name == $repository");
    expect(acceptance).toContain(".head_repository.full_name == $repository");
    expect(acceptance).toContain('.status == "completed"');
    expect(acceptance).toContain('.conclusion == "success"');
  });

  test("the reusable preflight includes root, plugin, build, scale, and browser gates", () => {
    const quality = jobBlock(ciWorkflow, "quality");
    const replay = jobBlock(ciWorkflow, "db-replay-validation");

    expect(quality).toContain("run: bun run test");
    expect(quality).toContain("run: bun run build");
    expect(quality).toContain("run: bun run plugin:apps:check");
    expect(replay).toContain("run: bun run csf:test:workflows");
    expect(replay).toContain("bun run csf:test:scale");
    expect(replay).toContain("bun run csf:test:import:scale");
    expect(replay).toContain("run: bun run csf:test:e2e");
  });
});
