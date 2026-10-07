import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const source = readFileSync(
  ".github/workflows/csf-hosted-development-acceptance.yml",
  "utf8",
);
const workflow = parse(source);

test("registered workflow routes optional cutover without changing ordinary acceptance", () => {
  assert.ok(workflow.on.push.branches.includes("development"));
  assert.equal(
    workflow.on.workflow_dispatch.inputs.cutover_phase.default,
    "none",
  );
  assert.ok(Object.keys(workflow.on.workflow_dispatch.inputs).length <= 10);
  assert.ok(
    workflow.jobs["release-selection"].if.includes(
      "inputs.cutover_phase == 'none'",
    ),
  );
  assert.ok(
    workflow.jobs["development-cutover"].if.includes(
      "github.event_name == 'workflow_dispatch'",
    ),
  );
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});

test("cutover uses reviewed workflow source, Development environment and read-only GitHub authority", () => {
  const job = workflow.jobs["development-cutover"];
  assert.equal(job.environment, "development");
  assert.ok(Object.values(job.permissions).every((value) => value === "read"));
  const checkout = job.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  const controller = job.steps.find((step) =>
    step.run?.includes("development-cutover.mjs"),
  );
  assert.equal(
    controller.env.DEVELOPMENT_DATABASE_URL,
    "${{ secrets.DEVELOPMENT_DATABASE_URL }}",
  );
  assert.equal(controller.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(controller.env.ACCEPTED_SHA, "${{ inputs.development_sha }}");
  assert.ok(!JSON.stringify(job).includes("PRODUCTION_READONLY_URL"));
});

test("unknown outcomes retain a sanitized receipt and forbid generic publication or migration commands", () => {
  const job = workflow.jobs["development-cutover"];
  const upload = job.steps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  assert.equal(upload.if, "always()");
  assert.equal(upload.with.overwrite, false);
  assert.equal(
    upload.with.path,
    ".artifacts/development-cutover/development-cutover.json",
  );
  assert.equal(upload.with.name, "development-cutover-${{ github.run_id }}");
  for (const command of ["db push", "gh pr merge", "production", "--prod"])
    assert.ok(!job.steps.some((step) => step.run?.includes(command)));
  for (const step of job.steps.filter((entry) => entry.uses))
    assert.match(step.uses, /@[a-f0-9]{40}$/u);
});
