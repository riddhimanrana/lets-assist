import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const deploymentWorkflow = readFileSync(
  join(repositoryRoot, ".github/workflows/deploy-schema.yml"),
  "utf8",
);
const supabaseDeploymentGuide = readFileSync(
  join(repositoryRoot, "docs/development/supabase-deployment.md"),
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

describe("CSF Production recovery window", () => {
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
      "Reassert Production application write block",
      "Prove a fresh Production application write is blocked",
      "Promote maintenance page to Production",
      "Verify Production maintenance alias",
      "Push schema to production",
      "Verify production schema deployment",
      "Verify CSF target schema compatibility",
      "Run full post-push Production cutover preflight",
      "Smoke the staged Production application",
      "Promote the staged application to Production",
      "Verify application promotion reached a terminal state",
      "Verify Production alias promotion",
      "Verify public Production release postcondition",
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
    expect(priorRecoveryStep).toContain(
      '.name == "Reassert Production application write block"',
    );
    expect(priorRecoveryStep).not.toContain(
      '.name == "Block Production application writes"',
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
    expect(normalTimeoutTotal).toBeLessThanOrEqual(71);
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
});
