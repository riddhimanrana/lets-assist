import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
