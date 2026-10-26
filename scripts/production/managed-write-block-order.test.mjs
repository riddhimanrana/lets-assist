import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-schema.yml", import.meta.url),
  "utf8",
);
const recovery = readFileSync(
  new URL(
    "../../.github/workflows/production-release-recovery.yml",
    import.meta.url,
  ),
  "utf8",
);
const earlyName = "Enable temporary managed-backup application write block";
const restoreName = "Restore owned temporary block before cutover";
function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, name);
  const end = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
}

test("managed guard ownership, enable, fresh HTTP and barrier all precede the first preflight", () => {
  const names = [
    "Record owned open state for managed-backup guard",
    earlyName,
    "Prove temporary managed-backup application write block",
    "Settle temporary managed-backup request transactions",
    "Run read-only Production cutover preflight",
  ];
  for (let i = 1; i < names.length; i++)
    assert.ok(
      workflow.indexOf(`      - name: ${names[i - 1]}\n`) <
        workflow.indexOf(`      - name: ${names[i]}\n`),
    );
  for (const name of names.slice(0, -1))
    assert.match(
      step(name),
      /startsWith\(inputs.recovery_capture_confirmation, 'managed-backup-accepted:'/u,
    );
  assert.ok(step(earlyName).includes("set-application-write-block.sh enable"));
  assert.ok(step(names[2]).includes("verify-postgrest-write-block.sh"));
  assert.ok(step(names[3]).includes("set-application-write-block.sh barrier"));
  const manifest = step("Write Production recovery manifest");
  assert.ok(manifest.includes('test "${EARLY_BLOCK_PROOF}" = success'));
  assert.ok(manifest.includes('test "${EARLY_BLOCK_BARRIER}" = success'));
  assert.ok(
    manifest.includes(
      "applicationWriteBlockAuthorization: $application_write_block_authorization",
    ),
  );
});

test("early cleanup requires acknowledged ownership and no late, alias or schema attempt; failure retains the block", () => {
  const restore = step(restoreName);
  for (const value of [
    "steps.early_enable_write_block.outcome == 'success'",
    "steps.enable_write_block.outcome == 'skipped'",
    "steps.promote_maintenance.outcome == 'skipped'",
    "steps.promote_application.outcome == 'skipped'",
    "steps.schema_push.outcome == 'skipped'",
  ])
    assert.ok(restore.includes(value));
  assert.ok(
    restore.indexOf("managed-write-block-state.mjs can-restore") <
      restore.indexOf("set-application-write-block.sh disable"),
  );
  assert.ok(
    restore.indexOf("set-application-write-block.sh disable") <
      restore.indexOf("managed-write-block-state.mjs restored"),
  );
  const retain = step("Retain Production write block after incomplete release");
  assert.ok(
    retain.includes("steps.restore_early_write_block.outcome != 'success'"),
  );
  assert.ok(retain.includes("set-application-write-block.sh enable"));
  assert.ok(retain.includes("verify-postgrest-write-block.sh"));
});

const jobs = (early = "success", restored = "success", overrides = {}) => ({
  jobs: [
    {
      name: "Deploy to Production",
      steps: [
        { name: earlyName, conclusion: early },
        { name: restoreName, conclusion: restored },
        ...[
          "Promote maintenance page to Production",
          "Promote the staged application to Production",
          "Push schema to production",
        ].map((name) => ({ name, conclusion: overrides[name] || "skipped" })),
      ],
    },
  ],
});
function evaluate(source, payload, late = "skipped") {
  const start = source.indexOf('early_guard_conclusion="$(jq -r');
  const end = source.indexOf('if [[ "${', start + 1);
  // Include the entire new early-guard branch, stopping before the original
  // late write-block branch. Execute actual workflow shell and actual jq.
  const stop = source.indexOf(
    source === workflow
      ? 'if [[ "${deploy_job_conclusion}"'
      : 'if [[ "${write_block_conclusion}" == "skipped" ]]; then',
    end + 1,
  );
  assert.ok(start >= 0 && stop > start);
  const snippet = source.slice(start, stop);
  return spawnSync(
    "bash",
    [
      "-c",
      `source_jobs="$SOURCE_JOBS"\nwrite_block_conclusion="$LATE"\nGITHUB_OUTPUT=/dev/stdout\nfor fixture in once; do\n${snippet}\necho late-path\ndone`,
    ],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        SOURCE_JOBS: JSON.stringify(payload),
        LATE: late,
      },
    },
  );
}

test("both recovery detectors recognize proven early restoration and refuse every uncertain cutover outcome", () => {
  for (const source of [workflow, recovery]) {
    const safe = evaluate(source, jobs());
    assert.equal(safe.status, 0, safe.stderr);
    assert.ok(!safe.stdout.includes("late-path"));
    for (const early of ["failure", "cancelled", "unknown"])
      assert.notEqual(evaluate(source, jobs(early)).status, 0);
    for (const restored of ["failure", "cancelled", "skipped", "unknown"])
      assert.notEqual(evaluate(source, jobs("success", restored)).status, 0);
    for (const name of [
      "Promote maintenance page to Production",
      "Promote the staged application to Production",
      "Push schema to production",
    ]) {
      for (const conclusion of ["success", "failure", "cancelled"])
        assert.notEqual(
          evaluate(source, jobs("success", "success", { [name]: conclusion }))
            .status,
          0,
        );
    }
    const duplicate = jobs();
    duplicate.jobs[0].steps.push({ name: earlyName, conclusion: "success" });
    assert.notEqual(evaluate(source, duplicate).status, 0);
    assert.match(
      evaluate(source, jobs("failure"), "success").stdout,
      /late-path/u,
    );
    const legacy = jobs();
    legacy.jobs[0].steps = legacy.jobs[0].steps.filter(
      (entry) => ![earlyName, restoreName].includes(entry.name),
    );
    assert.match(evaluate(source, legacy).stdout, /late-path/u);
  }
});
