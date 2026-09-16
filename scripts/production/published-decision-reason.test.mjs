import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { approvedMigrations } from "./forward-migration-release.mjs";

// Source-level checks. What this migration fixes is only observable through the
// decision RPCs against a database, so the behavioural proof is the pgTAP in
// supabase/tests/database/csf_published_decision_reason_sync.test.sql and the
// coordinator's API run. What is checkable here is that each restated function
// differs from its reviewed predecessor by exactly the listed edits and by
// nothing else.

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const migration = (name) =>
  readFileSync(`${cwd}supabase/migrations/${name}.sql`, "utf8");

const CURRENT = "20260917060000_csf_published_decision_reason";
const current = migration(CURRENT);

const bodyOf = (sql, signature) => {
  const lines = sql.split("\n");
  const start = lines.findIndex((line) =>
    line.startsWith(`CREATE OR REPLACE FUNCTION plugin_data.${signature}(`),
  );
  assert.notEqual(start, -1, `${signature} must be restated`);
  const end = lines.indexOf("$$;", start);
  assert.notEqual(end, -1, `${signature} must be terminated`);
  return lines.slice(start, end + 1).join("\n");
};

const PUBLISH = "csf_publish_sheet_application_decision";
const STAGE = "csf_stage_sheet_application_decisions";

// Every edit as [reviewed, shipped]. Undoing all of them has to reproduce the
// predecessor byte for byte.
const PUBLISH_EDITS = [
  [
    `  IF v_reason_code IS NOT NULL THEN
    UPDATE plugin_data.csf_term_applications
    SET decision_reason_code = v_reason_code`,
    `  --
  -- The published reason is settled here too. Every branch above hands the base
  -- or the direct write a fallback sentence, because the base refuses a
  -- rejection with no notes. That sentence is a workflow note: it belongs in
  -- review_notes and the receipts, not in the field the member reads as the
  -- chapter's explanation. A red mark carries no explanation, so it publishes
  -- none.
  IF v_reason_code IS NOT NULL THEN
    UPDATE plugin_data.csf_term_applications
    SET
      decision_reason_code = v_reason_code,
      decision_reason = v_reason`,
  ],
];

const gate = (head, then) => [
  `${head}
          AND row_plan.decision IS DISTINCT FROM row_plan.previous_decision
          THEN ${then}`,
  `${head}
          AND (
            row_plan.decision IS DISTINCT FROM row_plan.previous_decision
            OR row_plan.reason IS DISTINCT FROM row_plan.previous_released_reason
          )
          THEN ${then}`,
];
const CLOSED_HEAD = `        WHEN v_term_closed
          AND row_plan.previous_release_state = 'released'`;
const FINAL_HEAD = `        WHEN row_plan.previous_release_state = 'released'
          AND row_plan.membership_status IN ('completed', 'not_completed')`;

const STAGE_EDITS = [
  [
    "    previous_released_decision text,\n",
    "    previous_released_decision text,\n    previous_released_reason text,\n",
  ],
  [
    "    previous_reason, previous_release_state, previous_released_decision,\n    previous_source_id, membership_status, evidence",
    "    previous_reason, previous_release_state, previous_released_decision,\n    previous_released_reason, previous_source_id, membership_status, evidence",
  ],
  [
    "    stage.released_decision,\n    stage.source_id,",
    "    stage.released_decision,\n    stage.released_reason,\n    stage.source_id,",
  ],
  gate(CLOSED_HEAD, "'conflict'"),
  gate(FINAL_HEAD, "'conflict'"),
  gate(CLOSED_HEAD, "'term_closed'"),
  gate(FINAL_HEAD, "'historical_outcome'"),
  [
    `      AND (CASE WHEN decision = 'accepted' THEN 'accepted' ELSE 'rejected' END)
        IS DISTINCT FROM previous_released_decision
    ),`,
    `      AND (
        (CASE WHEN decision = 'accepted' THEN 'accepted' ELSE 'rejected' END)
          IS DISTINCT FROM previous_released_decision
        -- A yellow that loses its explanation and a red that gains one both
        -- normalize to 'rejected', so the published decision alone cannot see a
        -- reason-only correction. Both sides hold the same normalized text.
        OR reason IS DISTINCT FROM previous_released_reason
      )
    ),`,
  ],
];

const undo = (body, edits) => {
  let out = body;
  for (const [reviewed, shipped] of edits) {
    assert.equal(
      out.split(shipped).length,
      2,
      `edit is not present exactly once: ${shipped.slice(0, 60)}`,
    );
    out = out.replace(shipped, reviewed);
  }
  return out;
};

test("the publish primitive moves by exactly the published-reason edit", () => {
  assert.equal(
    undo(bodyOf(current, PUBLISH), PUBLISH_EDITS),
    bodyOf(migration("20260917030000_csf_finalized_outcome_guard"), PUBLISH),
  );
});

test("the sync planner moves by exactly the released-reason edits", () => {
  assert.equal(
    undo(bodyOf(current, STAGE), STAGE_EDITS),
    bodyOf(
      migration("20260917050000_csf_decision_plan_ordinal_safe_update"),
      STAGE,
    ),
  );
});

test("will_apply can see a reason-only correction", () => {
  const stage = bodyOf(current, STAGE);
  assert.match(stage, /OR reason IS DISTINCT FROM previous_released_reason/u);
  // The comparison is worthless unless the plan actually carries the column.
  assert.match(stage, /^ {4}previous_released_reason text,$/mu);
  assert.match(stage, /^ {4}stage\.released_reason,$/mu);
  assert.match(
    stage,
    /^ {4}previous_released_reason, previous_source_id, membership_status, evidence$/mu,
  );
});

test("a reason-only correction against finished history is held, not published", () => {
  const stage = bodyOf(current, STAGE);
  // Both gates, in the outcome CASE and in the block-reason CASE.
  assert.equal(
    (
      stage.match(
        /OR row_plan\.reason IS DISTINCT FROM row_plan\.previous_released_reason/gu,
      ) ?? []
    ).length,
    4,
  );
  for (const marker of ["'term_closed'", "'historical_outcome'"]) {
    assert.ok(stage.includes(marker));
  }
});

test("the safe-update work of 555 and 556 survives the restatement", () => {
  const stage = bodyOf(current, STAGE);
  assert.equal(
    (stage.match(/^\s*TRUNCATE TABLE pg_temp\./gmu) ?? []).length,
    2,
    "both plan tables the sync resets must still be truncated",
  );
  assert.doesNotMatch(stage, /^\s*DELETE FROM pg_temp\.\w+;$/mu);
  const writes = [
    ...stage.matchAll(/\b(?:UPDATE|DELETE\s+FROM)\s+pg_temp\.\w+/gu),
  ];
  assert.ok(writes.length >= 2);
  for (const write of writes) {
    const terminator = stage.indexOf(";\n", write.index);
    assert.notEqual(terminator, -1, `unterminated statement: ${write[0]}`);
    assert.match(
      stage.slice(write.index, terminator),
      /\n\s*WHERE\b/u,
      `${write[0]} has no WHERE clause and the request role will reject it`,
    );
  }
  assert.match(stage, /^ {2}WHERE ordinal IS NOT NULL;$/mu);
});

test("the permissions are restated unchanged", () => {
  const acl = (sql, name) =>
    sql
      .split("\n")
      .filter(
        (line) =>
          /^(?:REVOKE|GRANT)/u.test(line) || /^ +(?:FROM|TO) /u.test(line),
      )
      .join("\n")
      .split("\n")
      .filter(
        (line, index, all) =>
          line.includes(name) || (all[index - 1] ?? "").includes(name),
      )
      .join("\n");

  for (const [name, predecessor] of [
    [PUBLISH, "20260917030000_csf_finalized_outcome_guard"],
    [STAGE, "20260917050000_csf_decision_plan_ordinal_safe_update"],
  ]) {
    assert.equal(acl(current, name), acl(migration(predecessor), name), name);
  }
  // The primitive stays internal: only the two reviewed RPCs may reach it.
  assert.match(
    acl(current, PUBLISH),
    /FROM PUBLIC, anon, authenticated, service_role;/u,
  );
  assert.doesNotMatch(acl(current, PUBLISH), /^GRANT/mu);
  assert.match(acl(current, STAGE), /GRANT EXECUTE[^]*TO service_role;/u);
});

test("each pgTAP file plans the number of assertions it makes", () => {
  // A plan that undercounts passes pgTAP while silently dropping the tail of
  // the file, which is exactly where the sync cases are.
  for (const name of [
    "csf_published_decision_reason",
    "csf_published_decision_reason_sync",
  ]) {
    const sql = readFileSync(
      `${cwd}supabase/tests/database/${name}.test.sql`,
      "utf8",
    );
    const planned = Number(sql.match(/extensions\.plan\((\d+)\)/u)?.[1]);
    const asserted = (
      sql.match(/^SELECT extensions\.(is|ok|throws_ok)\(/gmu) ?? []
    ).length;
    assert.equal(planned, asserted, name);
  }
});

test("the shipped bytes are the bytes the release pins", () => {
  // Looked up by name rather than taken from the end of the list. Several lanes
  // add a migration at once, so being last is not this migration's property and
  // asserting it made an unrelated lane's append fail this test.
  const entry = approvedMigrations.find(([name]) => name === CURRENT);
  assert.ok(entry, `${CURRENT} is not in the approved migration list.`);
  assert.equal(createHash("sha256").update(current).digest("hex"), entry[1]);
});
