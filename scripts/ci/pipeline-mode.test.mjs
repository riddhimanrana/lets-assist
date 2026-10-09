import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const workflow = readFileSync(
  join(import.meta.dir, "../..", ".github/workflows/ci.yml"),
  "utf8",
);

const SHORT_PATH =
  "github.event_name == 'pull_request' || github.event_name == 'merge_group'";
const FULL_PATH =
  "github.event_name != 'pull_request' && github.event_name != 'merge_group'";
const NOT_DRAFT =
  "github.event_name != 'pull_request' || github.event.pull_request.draft == false";

const jobIds = [
  ...workflow
    .slice(workflow.indexOf("\njobs:\n"))
    .matchAll(/^ {2}([A-Za-z][\w-]*):\s*$/gmu),
].map((match) => match[1]);

// One job's own text: nothing here may be satisfied by a neighbouring job.
function job(name) {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name} job.`);
  const body = workflow.slice(start + marker.length);
  const next = /^ {2}[A-Za-z][\w-]*:\s*$/mu.exec(body);
  return next ? body.slice(0, next.index) : body;
}

function needs(name) {
  const block = /\n {4}needs:\n((?: {6}- [\w-]+\n)+)/u.exec(job(name));
  return block
    ? [...block[1].matchAll(/- ([\w-]+)/gu)].map((match) => match[1])
    : [];
}

describe("CI delivery modes", () => {
  test("the job inventory is the reviewed one", () => {
    expect(jobIds).toEqual([
      "static",
      "unit",
      "build",
      "quality",
      "database",
      "browser",
      "db-replay-validation",
      "ci-gate",
    ]);
  });

  test("installs ripgrep before root tests in pull request and reusable full gates", () => {
    for (const [name, commands] of [
      [
        "unit",
        [
          "run: bun run test --shard=",
          'run: bun run test:affected "$PR_BASE_SHA"',
        ],
      ],
      ["static", ["run: bun test scripts/ci/*.test.mjs"]],
    ]) {
      const block = job(name);
      const install = block.indexOf("- name: Install source audit tools\n");
      expect(install).toBeGreaterThan(0);
      const nextStep = block.indexOf("\n      - name:", install);
      const setup = block.slice(install, nextStep);
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
      for (const command of commands) {
        expect(block.indexOf(command)).toBeGreaterThan(nextStep);
      }
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
    const staticChecks = job("static");
    const unit = job("unit");
    const build = job("build");

    expect(staticChecks).toContain(`    if: ${NOT_DRAFT}\n`);
    expect(unit).toContain(`    if: ${NOT_DRAFT}\n`);
    for (const command of [
      "run: bun run plugin:submodules:check:strict",
      "run: bun run agent:check",
      "run: bun install --frozen-lockfile",
      "run: bun run security:audit",
      "run: bun run format:check",
      "bun run security:seeds",
      "bun run test:security:seeds",
      "run: bun run lint",
      "run: bun run plugin:check:boundary",
      "run: bun run plugin:apps:contract",
      "run: bun run typecheck",
      "run: bun test scripts/ci/*.test.mjs scripts/audit-agent-tooling.test.mjs",
    ]) {
      expect(staticChecks).toContain(command);
    }
    expect(staticChecks).toMatch(
      new RegExp(
        `- name: Check private application contracts\\n {8}if: ${SHORT_PATH.replaceAll("|", "\\|")}\\n`,
        "u",
      ),
    );
    for (const fullOnly of [
      "Check independent plugin applications",
      "Build and test the versioned plugin SDK",
      "Test signed plugin release integration",
    ]) {
      expect(staticChecks).toContain(
        `- name: ${fullOnly}\n        if: ${FULL_PATH}\n`,
      );
    }
    expect(staticChecks).toContain("run: bun run plugin:apps:check\n");
    expect(staticChecks).toContain("run: bun run plugin:sdk:test\n");
    expect(staticChecks).toContain(
      "run: bun run plugin:test:release-integration\n",
    );

    expect(unit).toContain(
      'run: bun run test:affected "$PR_BASE_SHA" --shard=${{ matrix.shard }}/${{ strategy.job-total }}\n',
    );
    expect(unit).toContain(
      "PR_BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}",
    );
    expect(unit).toContain("fetch-depth: 0");
    expect(unit).toContain(
      `- name: Test affected pull request units\n        if: ${SHORT_PATH}\n`,
    );
    expect(unit).toContain(
      `- name: Root and plugin tests\n        if: ${FULL_PATH}\n`,
    );
    expect(unit).toContain(
      "run: bun run test --shard=${{ matrix.shard }}/${{ strategy.job-total }}\n",
    );

    expect(build).toContain(`    if: ${FULL_PATH}\n`);
    expect(build).toContain("run: bun run build\n");
    expect(build).toContain("run: bun run plugin:submodules:check:strict");
  });

  test("unit tests are sharded two ways on the short path and three on the full path", () => {
    const unit = job("unit");
    expect(unit).toContain(
      `shard: \${{ fromJSON((${SHORT_PATH}) && '[1, 2]' || '[1, 2, 3]') }}`,
    );
    expect(unit).toContain("fail-fast: false");
    // Both runners derive the share from the matrix, never from a literal that
    // could disagree with the number of runners.
    expect(unit.match(/--shard=/gu)?.length).toBe(2);
    expect(
      unit.match(
        /--shard=\$\{\{ matrix\.shard \}\}\/\$\{\{ strategy\.job-total \}\}/gu,
      )?.length,
    ).toBe(2);
  });

  test("database and browser validation runs only outside pull requests and queued merges", () => {
    for (const name of ["database", "browser"]) {
      expect(job(name)).toContain(`    if: ${FULL_PATH}\n`);
      expect(job(name)).not.toContain("github.event.pull_request.draft");
    }
    const replay = job("db-replay-validation");
    expect(replay).toContain(`      always() &&\n      (${FULL_PATH})\n`);
    expect(job("browser")).toContain(
      "run: bun run csf:test:e2e --shard=${{ matrix.shard }}/${{ strategy.job-total }}\n",
    );
    expect(job("browser")).toContain("shard: [1, 2, 3, 4]");
    expect(job("browser")).toContain("fail-fast: false");
  });

  test("queued merges run the short path and never the full one", () => {
    const triggers = workflow.slice(0, workflow.indexOf("\nconcurrency:\n"));
    expect(triggers).toContain(
      "  merge_group:\n    types:\n      - checks_requested\n",
    );
    // No expression may still treat "not a pull request" as "full run": that
    // would send every queue entry down the full path.
    const expressions = workflow
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n")
      .replaceAll(NOT_DRAFT, "");
    expect(expressions).not.toMatch(
      /github\.event_name != 'pull_request'(?! && github\.event_name != 'merge_group')/u,
    );
    expect(expressions).not.toMatch(
      /github\.event_name == 'pull_request'(?! \|\| github\.event_name == 'merge_group')/u,
    );
    expect(job("quality")).toContain(
      `name: \${{ (${SHORT_PATH}) && 'pr-quality' || 'full-quality' }}`,
    );
    expect(workflow).toContain(
      "startsWith(github.ref, 'refs/heads/gh-readonly-queue/main/')",
    );
  });

  test("the quality check summarizes every quality job", () => {
    const quality = job("quality");
    expect(needs("quality")).toEqual(["static", "unit", "build"]);
    expect(quality).toContain(`      always() &&\n      (${NOT_DRAFT})\n`);
    expect(quality).toContain(`FULL_VALIDATION: \${{ ${FULL_PATH} }}`);
    for (const [variable, id] of [
      ["STATIC_RESULT", "static"],
      ["UNIT_RESULT", "unit"],
      ["BUILD_RESULT", "build"],
    ]) {
      expect(quality).toContain(`${variable}: \${{ needs.${id}.result }}`);
    }
    expect(quality).toContain("set -euo pipefail");
    expect(quality).toContain('[[ "${STATIC_RESULT}" == "success" ]]');
    expect(quality).toContain('[[ "${UNIT_RESULT}" == "success" ]]');
    expect(quality).toContain('[[ "${BUILD_RESULT}" == "success" ]]');
    expect(quality).toContain('[[ "${BUILD_RESULT}" == "skipped" ]]');
    expect(quality).not.toContain("continue-on-error");
  });

  test("the database check summarizes the database job and every browser shard", () => {
    const replay = job("db-replay-validation");
    expect(replay).toContain("    name: db-replay-validation\n");
    expect(needs("db-replay-validation")).toEqual(["database", "browser"]);
    expect(replay).toContain(
      "DATABASE_CHECKS_RESULT: ${{ needs.database.result }}",
    );
    expect(replay).toContain("BROWSER_RESULT: ${{ needs.browser.result }}");
    expect(replay).toContain("set -euo pipefail");
    expect(replay).toContain('[[ "${DATABASE_CHECKS_RESULT}" == "success" ]]');
    expect(replay).toContain('[[ "${BROWSER_RESULT}" == "success" ]]');
    // Its own run script accepts success only; the short path skips the job.
    expect(replay.slice(replay.indexOf("        run: |\n"))).not.toContain(
      "skipped",
    );
    expect(replay).not.toContain("continue-on-error");
  });

  test("the aggregate gate requires full validation outside pull requests", () => {
    const gate = job("ci-gate");
    expect(gate).toContain("    name: ci-gate\n");
    expect(gate).toContain(`FULL_VALIDATION: \${{ ${FULL_PATH} }}`);
    expect(gate).toContain(`      always() &&\n      (${NOT_DRAFT})\n`);
    expect(gate).toContain('[[ "${DATABASE_RESULT}" == "success" ]]');
    expect(gate).toContain('[[ "${DATABASE_RESULT}" == "skipped" ]]');
    expect(gate).toContain("\n          fi\n");
    expect(gate).not.toContain("continue-on-error");
  });

  test("the aggregate gate needs every other job and checks each result", () => {
    const gate = job("ci-gate");
    // A job added to the workflow without being added here fails this test.
    expect(needs("ci-gate")).toEqual(jobIds.filter((id) => id !== "ci-gate"));

    const script = gate.slice(gate.indexOf("        run: |\n"));
    const [always, rest] = script.split(
      'if [[ "${FULL_VALIDATION}" == "true" ]]; then\n',
    );
    const [full, short] = rest.split("          else\n");
    const variables = {
      static: "STATIC_RESULT",
      unit: "UNIT_RESULT",
      build: "BUILD_RESULT",
      quality: "QUALITY_RESULT",
      database: "DATABASE_CHECKS_RESULT",
      browser: "BROWSER_RESULT",
      "db-replay-validation": "DATABASE_RESULT",
    };
    expect(Object.keys(variables)).toEqual(needs("ci-gate"));
    for (const [id, variable] of Object.entries(variables)) {
      expect(gate).toContain(`${variable}: \${{ needs.${id}.result }}`);
    }
    expect(script).toContain("set -euo pipefail");
    const requires = (block, variable, result) =>
      block.includes(`[[ "\${${variable}}" == "${result}" ]]`);

    // Jobs that apply to every event must succeed unconditionally.
    for (const id of ["static", "unit", "quality"]) {
      expect(requires(always, variables[id], "success"), id).toBe(true);
    }
    // Full-path jobs must succeed on the full path and be skipped, not merely
    // absent or failed, on the short path.
    for (const id of ["build", "database", "browser", "db-replay-validation"]) {
      expect(requires(full, variables[id], "success"), id).toBe(true);
      expect(requires(short, variables[id], "skipped"), id).toBe(true);
    }
    // The only accepted results are success and an expected skip.
    expect(
      [...script.matchAll(/== "([a-z]+)" \]\]/gu)].map((m) => m[1]),
    ).toEqual([
      "success",
      "success",
      "success",
      "true",
      "success",
      "success",
      "success",
      "success",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);
  });

  test("the clean replay must match the release catalog before fixtures", () => {
    const replay = job("database");
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

  test("the database validations run once and never inside a browser shard", () => {
    const database = job("database");
    const browser = job("browser");
    for (const once of [
      "supabase test db --workdir",
      "node scripts/csf/check-decision-release-timeout.mjs",
      "bun run csf:test:retired-code-backfill",
      "bun run db:test:hours-concurrency",
      "bun run csf:test:workflows",
      "bun run csf:test:scale",
      "bun run csf:test:import:scale",
      "bun run dev:test:cron",
    ]) {
      expect(database.split(once).length - 1, once).toBe(1);
      expect(browser, once).not.toContain(once);
    }
    expect(database).not.toContain("strategy:");
    expect(database).not.toContain("csf:test:e2e");
  });
});
