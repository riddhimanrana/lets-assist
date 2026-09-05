import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL(
    "../../.github/workflows/production-release-recovery.yml",
    import.meta.url,
  ),
  "utf8",
);
const start = workflow.indexOf("          wait_for_exact_operation() {");
const end = workflow.indexOf(
  "          request_maintenance_operation() {",
  start,
);
assert.ok(start > 0 && end > start);
const functionBody = workflow.slice(start, end).replace(/^ {10}/gm, "");

function check(record, result = "alias_operation_outcome=alias-settled") {
  try {
    return execFileSync(
      "bash",
      [
        "-c",
        `set -euo pipefail
timeout() { printf '%s\\n' "$FIXTURE_RESULT"; }
read_current_alias_operation() { printf '%s\\n' "$FIXTURE_RECORD"; }
${functionBody}
wait_for_exact_operation rollback dpl_expected
printf '%s' "$exact_operation_status"
`,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FIXTURE_RECORD: record, FIXTURE_RESULT: result },
      },
    ).trim();
  } catch {
    return null;
  }
}

test("recovery accepts absent metadata only after the verifier proves the alias", () => {
  assert.ok(check("missing\tmissing\tmissing").endsWith("alias-settled"));
  assert.equal(check("missing\tmissing\tmissing", "terminal"), null);
});

test("recovery rejects new pending or different operations after alias verification", () => {
  assert.equal(check("rollback\tdpl_expected\tpending"), null);
  assert.equal(check("promote\tdpl_other\tsucceeded"), null);
  assert.ok(
    check("rollback\tdpl_expected\tsucceeded", "terminal").endsWith(
      "succeeded",
    ),
  );
});

test("initial absent metadata is fenced against an exact maintenance or app alias", () => {
  const branchStart = workflow.indexOf(
    'if [[ "${current_operation}:${current_deployment}:${current_status}" == "missing:missing:missing" ]]',
  );
  const branchEnd = workflow.indexOf(
    'elif [[ "${current_deployment}" == "${MAINTENANCE_DEPLOYMENT_ID}"',
    branchStart,
  );
  assert.ok(branchStart > 0 && branchEnd > branchStart);
  const branch = workflow.slice(branchStart, branchEnd);
  assert.ok(
    branch.includes(
      'wait_for_exact_operation rollback "${MAINTENANCE_DEPLOYMENT_ID}"',
    ),
  );
  assert.ok(
    branch.indexOf(
      'wait_for_exact_operation promote "${APPLICATION_DEPLOYMENT_ID}"',
    ) < branch.indexOf("request_maintenance_operation rollback"),
  );
  assert.ok(branch.includes("exit 1"));
});
