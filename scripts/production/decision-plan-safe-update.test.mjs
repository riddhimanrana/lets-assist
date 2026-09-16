import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { approvedMigrations } from "./forward-migration-release.mjs";

// These are source-level checks, not behavioural ones. The safe-update guard
// that rejects an unqualified UPDATE lives in the request role's session
// policy, and nothing in this repository's test environments runs under that
// policy: pgTAP and direct psql both connect as a role the guard does not
// apply to, so neither can reproduce the failure or prove the fix. What is
// checkable here is that the shipped SQL carries a WHERE clause on every write
// to the plan tables and that nothing else in the reviewed body moved. The
// guard itself is proved only by the service-role PostgREST preflight against
// a database with this migration applied.

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const read = (version, name) =>
  readFileSync(`${cwd}supabase/migrations/${version}_${name}.sql`, "utf8");

const previous = read(
  "20260917040000",
  "csf_decision_plan_reset_safe_update",
).split("\n");
const currentSource = read(
  "20260917050000",
  "csf_decision_plan_ordinal_safe_update",
);
const current = currentSource.split("\n");

const stageOf = (lines) => {
  const start = lines.findIndex((line) =>
    line.startsWith(
      "CREATE OR REPLACE FUNCTION plugin_data.csf_stage_sheet_application_decisions(",
    ),
  );
  assert.notEqual(start, -1, "the staged-decision function must be restated");
  const end = lines.indexOf("$$;", start);
  assert.notEqual(end, -1, "the restated function must be terminated");
  return lines.slice(start, end + 1).join("\n");
};

const addedPredicate = `    )
  -- Every plan row is inserted with a WITH ORDINALITY ordinal, so this
  -- predicate is total over the table and no row's verdict changes. It is here
  -- because the request role's safe-update guard rejects an UPDATE that has no
  -- WHERE clause before the statement runs.
  WHERE ordinal IS NOT NULL;`;

test("the staged-decision function moves by exactly the ordinal predicate", () => {
  const before = stageOf(previous);
  const after = stageOf(current);
  assert.ok(
    after.includes(addedPredicate),
    "the will_apply/will_retract UPDATE must carry the ordinal predicate",
  );
  // Undoing the one addition has to reproduce the reviewed 555 body byte for
  // byte. Any other edit, anywhere in the 596-line function, fails here.
  assert.equal(after.replace(addedPredicate, "    );"), before);
});

test("no write to a plan table is left unqualified", () => {
  const stage = stageOf(current);
  const writes = [
    ...stage.matchAll(/\b(?:UPDATE|DELETE\s+FROM)\s+pg_temp\.\w+/gu),
  ];
  assert.ok(writes.length >= 2, "the plan writes must still be present");
  for (const write of writes) {
    const terminator = stage.indexOf(";\n", write.index);
    assert.notEqual(terminator, -1, `unterminated statement: ${write[0]}`);
    const statement = stage.slice(write.index, terminator);
    assert.match(
      statement,
      /\n\s*WHERE\b/u,
      `${write[0]} has no WHERE clause and the request role will reject it`,
    );
  }
});

test("the reset carried forward from 555 stays a TRUNCATE", () => {
  // 555 replaced three unqualified DELETEs with TRUNCATE. Restating the
  // function must not reintroduce them.
  const stage = stageOf(current);
  assert.equal(
    (stage.match(/^\s*TRUNCATE TABLE pg_temp\./gmu) ?? []).length,
    2,
    "both plan tables the stage function resets must still be truncated",
  );
  assert.doesNotMatch(stage, /^\s*DELETE FROM pg_temp\.\w+;$/mu);
});

test("the function's permissions are restated unchanged", () => {
  const acl = (lines) =>
    lines
      .filter((line) => /^(?:REVOKE|GRANT|\s+(?:FROM|TO) )/u.test(line))
      .filter(
        (line, index, all) =>
          /csf_stage_sheet_application_decisions/u.test(line) ||
          /csf_stage_sheet_application_decisions/u.test(all[index - 1] ?? ""),
      )
      .join("\n");
  assert.equal(acl(current), acl(previous));
  assert.match(acl(current), /TO service_role;$/u);
  assert.doesNotMatch(acl(current), /GRANT[^]*\b(?:anon|authenticated)\b/u);
});

test("the release function is not restated by this migration", () => {
  // Both of its writes already carry a WHERE clause, so it has no reason to
  // move, and leaving it alone keeps its reviewed fingerprint out of scope.
  assert.doesNotMatch(
    currentSource,
    /CREATE OR REPLACE FUNCTION plugin_data\.csf_release_sheet_application_decisions/u,
  );
});

test("the shipped bytes are the bytes the release pins", () => {
  const [name, hash] =
    approvedMigrations.find(
      ([entry]) =>
        entry === "20260917050000_csf_decision_plan_ordinal_safe_update",
    ) ?? [];
  assert.ok(name, "the approved tail must still pin this migration");
  assert.equal(
    createHash("sha256").update(currentSource).digest("hex"),
    hash,
    "the approved migration tail must pin this migration's exact bytes",
  );
});
