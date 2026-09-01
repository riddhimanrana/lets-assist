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

function jobBlock(source: string, name: string) {
  const marker = `\n  ${name}:\n`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${name} job is missing`);
  const body = source.slice(start + marker.length);
  const nextJob = /^ {2}[A-Za-z][A-Za-z0-9_-]*:\s*$/mu.exec(body);
  return nextJob ? body.slice(0, nextJob.index) : body;
}

describe("CSF Production release preflight", () => {
  test("the confirmed Production workflow calls the exact reusable CI gates", () => {
    const preflight = jobBlock(deploymentWorkflow, "csf-release-gates");

    expect(ciWorkflow).toContain("  workflow_call:");
    expect(preflight).toContain("uses: ./.github/workflows/ci.yml");
    expect(preflight).toContain("secrets: inherit");
  });

  test("deployment requires the reusable gate and retains action-time confirmation", () => {
    const deployment = jobBlock(deploymentWorkflow, "deploy-to-production");

    expect(deployment).toContain("hosted-development-acceptance,");
    expect(deployment).toContain("github.ref == 'refs/heads/main'");
    expect(deployment).toContain(
      "inputs.production_confirmation == 'deploy-production:fotdmeakexgrkronxlof'",
    );
    expect(deployment).toContain("environment: production");
  });

  test("Production requires the exact hosted Development tree and successful status", () => {
    const acceptance = jobBlock(
      deploymentWorkflow,
      "hosted-development-acceptance",
    );

    expect(deploymentWorkflow).toContain("hosted_development_sha:");
    expect(acceptance).toContain("git merge-base --is-ancestor");
    expect(acceptance).toContain('git rev-parse "${ACCEPTED_SHA}^{tree}"');
    expect(acceptance).toContain("git rev-parse 'HEAD^{tree}'");
    expect(acceptance).toContain(
      'csf-hosted-development-acceptance" and .state == "success"',
    );
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
