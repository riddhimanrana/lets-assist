import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-schema.yml", import.meta.url),
  "utf8",
);
const start = workflow.indexOf('              commit_statuses="$(gh api');
const end = workflow.indexOf(
  '              if [[ "${trusted_recovery}" == "true" ]]',
  start,
);
assert.ok(start > 0 && end > start);
const consumer = workflow.slice(start, end).replace(/^ {14}/gmu, "");
const repository = "example/application";
const sha = "a".repeat(40);
const context = "production-release-recovery/123/1";
const status = (patch = {}) => ({
  id: 10,
  context,
  state: "success",
  created_at: "2026-10-26T03:30:00Z",
  creator: { login: "github-actions[bot]" },
  target_url: `https://github.com/${repository}/actions/runs/42`,
  ...patch,
});
const run = (patch = {}) => ({
  id: 42,
  name: "Reconcile Production Release",
  path: ".github/workflows/production-release-recovery.yml",
  event: "workflow_run",
  head_branch: "main",
  repository: { full_name: repository },
  status: "completed",
  conclusion: "success",
  ...patch,
});
function check(pages, record = run()) {
  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
    gh() {
      [[ "$1" == api ]] || return 1
      if [[ "$2" == --paginate ]]; then
        [[ "$#" == 4 && "$3" == --slurp && "$4" == "repos/$GITHUB_REPOSITORY/commits/$source_sha/statuses?per_page=100" ]] || return 1
        printf '%s' "$STATUS_PAGES"
      elif [[ "$2" == "repos/$GITHUB_REPOSITORY/actions/runs/42" ]]; then
        printf '%s' "$WORKFLOW_RUN"
      else
        return 1
      fi
    }
${consumer}
[[ "$trusted_recovery" == true ]]`,
    ],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_REPOSITORY: repository,
        source_sha: sha,
        recovery_context: context,
        STATUS_PAGES: JSON.stringify(pages),
        WORKFLOW_RUN: JSON.stringify(record),
      },
    },
  );
  return result;
}

test("recovery consumes all pages of individual statuses with creator metadata", () => {
  const unrelated = Array.from({ length: 100 }, (_, id) =>
    status({ id: id + 100, context: "unrelated" }),
  );
  const result = check([unrelated, [status()]]);
  assert.equal(result.status, 0, result.stderr);
  const projected = status();
  delete projected.creator;
  assert.notEqual(check([[projected]]).status, 0);
  assert.notEqual(check({ statuses: [projected] }).status, 0);
});

test("latest exact-context ID wins before author checks, including timestamp ties", () => {
  for (const patch of [
    { state: "pending" },
    { state: "failure" },
    { creator: { login: "operator" } },
    { creator: null },
  ]) {
    assert.notEqual(
      check([[status()], [status({ id: 11, ...patch })]]).status,
      0,
    );
    assert.notEqual(
      check([[status({ id: 11, ...patch })], [status()]]).status,
      0,
    );
  }
  assert.equal(
    check([
      [status({ id: 11 })],
      [status({ state: "failure", created_at: "2026-10-26T03:31:00Z" })],
    ]).status,
    0,
  );
  assert.equal(
    check([
      [status(), status({ id: 99, context: `${context}0`, state: "failure" })],
    ]).status,
    0,
  );
});

test("recovery still requires the exact context, trusted successful author and run URL", () => {
  for (const patch of [
    { context: `${context}0` },
    { creator: { login: "operator" } },
    { state: "pending" },
    { state: "failure" },
    { target_url: "https://untrusted.invalid/actions/runs/42" },
    { target_url: `https://github.com/${repository}/actions/runs/42/extra` },
    { target_url: `https://github.com/${repository}/actions/runs/0` },
  ])
    assert.notEqual(check([[status(patch)]]).status, 0);
  assert.notEqual(check([]).status, 0);
});

test("the original recovery workflow and repository identity checks still execute", () => {
  for (const patch of [
    { id: 43 },
    { name: "Untrusted" },
    { path: ".github/workflows/untrusted.yml" },
    { event: "workflow_dispatch" },
    { head_branch: "development" },
    { repository: { full_name: "fork/application" } },
    { status: "in_progress" },
    { conclusion: "failure" },
  ])
    assert.notEqual(check([[status()]], run(patch)).status, 0);
});
