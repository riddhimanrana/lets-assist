import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const workflow = readFileSync(
  join(import.meta.dir, "../..", ".github/workflows/ci.yml"),
  "utf8",
);

function job(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`Missing ${name} job.`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:\n`, start + 1) : -1;
  return workflow.slice(start, end < 0 ? undefined : end);
}

describe("CI delivery modes", () => {
  test("installs ripgrep before root tests in pull request and reusable full gates", () => {
    const quality = job("quality", "db-replay-validation");
    const install = quality.indexOf("- name: Install source audit tools\n");
    expect(install).toBeGreaterThan(0);
    const nextStep = quality.indexOf("\n      - name:", install);
    const setup = quality.slice(install, nextStep);
    expect(setup).not.toContain("if:");
    expect(setup).not.toContain("continue-on-error:");
    expect(setup).toContain("sudo apt-get update");
    expect(setup).toContain(
      "sudo apt-get install --yes --no-install-recommends ripgrep",
    );
    expect(setup.indexOf("sudo apt-get install")).toBeGreaterThan(
      setup.indexOf("sudo apt-get update"),
    );
    expect(setup.indexOf("rg --version")).toBeGreaterThan(
      setup.indexOf("sudo apt-get install"),
    );
    for (const command of [
      "run: bun run test\n",
      'run: bun run test:affected "$PR_BASE_SHA"',
      "run: bun test scripts/ci/*.test.mjs",
    ]) {
      expect(quality.indexOf(command)).toBeGreaterThan(nextStep);
    }
    expect(workflow).toContain("  workflow_call:\n");
    const release = readFileSync(
      join(import.meta.dir, "../../.github/workflows/deploy-schema.yml"),
      "utf8",
    );
    expect(release).toMatch(
      /\n {2}csf-release-gates:\n(?:(?!\n {2}[\w-]+:)[\s\S])*uses: \.\/\.github\/workflows\/ci\.yml/u,
    );
  });

  test("pull requests run the short quality gate", () => {
    const quality = job("quality", "db-replay-validation");
    expect(quality).toContain("run: bun run plugin:apps:contract");
    expect(quality).toContain("run: bun run typecheck");
    expect(quality).toContain('run: bun run test:affected "$PR_BASE_SHA"');
    expect(quality).toContain(
      "PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    );
    expect(quality).toContain("fetch-depth: 0");
    expect(quality).toContain("if: github.event_name != 'pull_request'");
    expect(quality).toContain("run: bun run test");
    expect(quality).toContain("run: bun run build");
  });

  test("database and browser validation runs only outside pull requests", () => {
    const replay = job("db-replay-validation", "ci-gate");
    expect(replay).toContain("if: github.event_name != 'pull_request'");
    expect(replay).toContain("run: bun run csf:test:e2e");
  });

  test("the aggregate gate requires full validation outside pull requests", () => {
    const gate = job("ci-gate");
    expect(gate).toContain(
      "FULL_VALIDATION: ${{ github.event_name != 'pull_request' }}",
    );
    expect(gate).toContain('[[ "${DATABASE_RESULT}" == "success" ]]');
    expect(gate).toContain('[[ "${DATABASE_RESULT}" == "skipped" ]]');
    expect(gate).toContain("\n          fi\n");
  });

  test("the clean replay must match the release catalog before fixtures", () => {
    const replay = job("db-replay-validation", "ci-gate");
    const catalog = replay.indexOf(
      "Verify the release catalog before loading fixtures",
    );
    const databaseTests = replay.indexOf(
      "Validate database tests on the same running isolated stack",
    );
    const seed = replay.indexOf("Seed fictional platform fixtures");
    expect(catalog).toBeGreaterThan(0);
    expect(databaseTests).toBeGreaterThan(catalog);
    expect(seed).toBeGreaterThan(databaseTests);
    const check = replay.slice(catalog, databaseTests);
    expect(check).toContain("dv-local-env.mjs --csf-health");
    expect(check).toContain("expectedVersions(process.cwd())");
    expect(check).toContain('psql "${DB_URL}" -X -q -v ON_ERROR_STOP=1 -At');
    expect(check).toContain(
      "isolatedReleaseCatalogQuery(acceptedCatalogQuery(",
    );
    expect(check).toContain('if [[ "${catalog_result}" != "1" ]]; then');
    expect(check).toContain("exit 1");
  });
});
