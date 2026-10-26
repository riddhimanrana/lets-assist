import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-schema.yml", import.meta.url),
  "utf8",
);
const start = workflow.indexOf('          status_record="$(gh api');
const end = workflow.indexOf("\n  production-recovery-gate:", start);
assert.ok(start > 0 && end > start);
const consumer = workflow.slice(start, end).replace(/^ {10}/gmu, "");
const repository = "example/application";
const sha = "a".repeat(40);
const status = (patch = {}) => ({
  id: 10,
  context: "csf-hosted-development-functional",
  state: "success",
  created_at: "2026-10-26T03:30:00Z",
  creator: { login: "github-actions[bot]" },
  target_url: `https://github.com/${repository}/actions/runs/42`,
  ...patch,
});
const run = (patch = {}) => ({
  id: 42,
  path: ".github/workflows/csf-hosted-development-acceptance.yml",
  head_sha: sha,
  head_branch: "development",
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  status: "completed",
  conclusion: "success",
  event: "push",
  ...patch,
});
function check(pages, record = run()) {
  return spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
  gh() {
    [[ "$1" == api ]] || return 1
    if [[ "$2" == --paginate ]]; then
      [[ "$#" == 3 && "$3" == "repos/$GITHUB_REPOSITORY/commits/$ACCEPTED_SHA/statuses?per_page=100" ]] || return 1
      jq -c '.[]' <<< "$STATUS_PAGES"
    elif [[ "$2" == "repos/$GITHUB_REPOSITORY/actions/runs/42" ]]; then
      printf '%s' "$WORKFLOW_RUN"
    else
      return 1
    fi
  }
${consumer}`,
    ],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_REPOSITORY: repository,
        ACCEPTED_SHA: sha,
        STATUS_PAGES: JSON.stringify(pages),
        WORKFLOW_RUN: JSON.stringify(record),
      },
    },
  );
}

test("the actual workflow consumes individual paginated statuses with creator metadata", () => {
  const unrelated = Array.from({ length: 100 }, (_, index) =>
    status({ id: 1000 + index, context: "unrelated-check" }),
  );
  const result = check([unrelated, [status()]]);
  assert.equal(result.status, 0, result.stderr);
});

test("the realistic combined projection without creator cannot authorize a release", () => {
  const projected = status();
  delete projected.creator;
  assert.notEqual(
    check({ state: "success", statuses: [projected], total_count: 1 }).status,
    0,
  );
  assert.notEqual(check([[projected]]).status, 0);
});

test("latest numeric status wins across pages; an older success cannot mask failure", () => {
  assert.notEqual(
    check([[status()], [status({ id: 11, state: "failure" })]]).status,
    0,
  );
  assert.equal(
    check([[status({ id: 11 })], [status({ id: 10, state: "failure" })]])
      .status,
    0,
  );
  assert.equal(
    check([
      [status()],
      [status({ id: 9, state: "pending", created_at: "2026-10-26T03:31:00Z" })],
    ]).status,
    0,
  );
});

test("context, creator, trusted URL and successful status remain mandatory", () => {
  for (const patch of [
    { context: "csf-hosted-development-acceptance" },
    { creator: { login: "someone" } },
    { creator: null },
    { state: "pending" },
    { state: "failure" },
    { target_url: "https://untrusted.invalid/actions/runs/42" },
    { target_url: `https://github.com/${repository}/actions/runs/42/extra` },
  ])
    assert.notEqual(check([[status(patch)]]).status, 0);
  assert.notEqual(check([]).status, 0);
  assert.notEqual(
    check([[status({ id: 11, creator: { login: "someone" } })], [status()]])
      .status,
    0,
  );
});

test("the original exact successful workflow/source/repository provenance checks still execute", () => {
  for (const patch of [
    { head_sha: "b".repeat(40) },
    { head_branch: "main" },
    { path: ".github/workflows/untrusted.yml" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { event: "pull_request" },
    { repository: { full_name: "fork/application" } },
    { head_repository: { full_name: "fork/application" } },
  ])
    assert.notEqual(check([[status()]], run(patch)).status, 0);
  assert.equal(
    check([[status()]], run({ event: "workflow_dispatch" })).status,
    0,
  );
});

test("explicit hosted waiver binds both sources and records an honest audit summary", () => {
  const waiverStart = workflow.indexOf(
    '          if [[ -n "${HOSTED_ACCEPTANCE_WAIVER:-}"',
  );
  assert.ok(
    waiverStart >
      workflow.indexOf("schema-release-ci-evidence.mjs --source-only"),
  );
  const waiverBody = workflow
    .slice(waiverStart, start)
    .replace(/^ {10}/gmu, "");
  const root = mkdtempSync(join(tmpdir(), "hosted-waiver-"));
  const summary = join(root, "summary");
  const release = "b".repeat(40);
  const token = `waive-hosted-acceptance:${release}:${sha}`;
  const reason = "Operator explicitly accepts the hosted test risk.";
  const execute = (waiver, explanation) =>
    spawnSync("bash", ["-c", `set -euo pipefail\n${waiverBody}\nexit 9`], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOSTED_ACCEPTANCE_WAIVER: waiver,
        HOSTED_ACCEPTANCE_WAIVER_REASON: explanation,
        GITHUB_SHA: release,
        ACCEPTED_SHA: sha,
        GITHUB_ACTOR: "operator",
        GITHUB_RUN_ID: "123",
        GITHUB_STEP_SUMMARY: summary,
      },
    });
  try {
    assert.equal(execute("", "").status, 9);
    for (const [waiver, explanation] of [
      [token, ""],
      ["", reason],
      [token, "short"],
      [token, "x".repeat(1001)],
      [token + "x", reason],
      [`waive-hosted-acceptance:${sha}:${release}`, reason],
    ]) {
      assert.notEqual(execute(waiver, explanation).status, 0);
    }
    const result = execute(token, reason);
    assert.equal(result.status, 0, result.stderr);
    const audit = readFileSync(summary, "utf8");
    assert.match(audit, /waived, not passed/u);
    const record = JSON.parse(audit.slice(audit.indexOf("{")));
    assert.deepEqual(record, {
      actor: "operator",
      run: "123",
      source: release,
      acceptedDevelopment: sha,
      reason,
    });
    assert.equal(execute(token, "x".repeat(20)).status, 0);
    assert.equal(execute(token, "x".repeat(1000)).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
