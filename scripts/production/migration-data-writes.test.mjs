import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  prohibitedDataWrites,
  topLevelDataWrites,
  unreviewedDataWrites,
  reviewedMigrationDataWrites,
} from "./migration-data-writes.mjs";
const table = "public.organization_plugin_installs";
for (const sql of [
  `insert into ${table} values (1);`,
  `uPdAtE PUBLIC.ORGANIZATION_PLUGIN_INSTALLS set status='active';`,
  `delete\nfrom ${table} where id=1;`,
  `WITH source AS (SELECT 1) INSERT INTO ${table} SELECT * FROM source;`,
  `with removed as (delete from ${table} returning *) select * from removed;`,
  `WITH changed AS (UPDATE ${table} SET status='active' RETURNING *) DELETE FROM plugin_data.csf_profiles;`,
  `insert /* whitespace */ into "public" . "organization_plugin_installs" values (1);`,
  `DO $guard$ BEGIN insert into ${table} values (1); END $guard$;`,
])
  test(`detects ${sql}`, () => {
    assert.ok(prohibitedDataWrites(sql).some((write) => write.table === table));
    assert.ok(unreviewedDataWrites(sql).length > 0);
  });
test("strings, comments, and function definitions are not executing writes", () => {
  assert.deepEqual(
    topLevelDataWrites(
      `SELECT 'insert into ${table};'; -- UPDATE ${table};\n /* DELETE FROM ${table}; */ CREATE FUNCTION fixture() RETURNS void AS $f$ BEGIN INSERT INTO ${table} VALUES(1); END $f$ LANGUAGE plpgsql;`,
    ),
    [],
  );
});
test("one-line statements and semicolons in literals retain correct boundaries", () => {
  const writes = topLevelDataWrites(
    `BEGIN; update ${table} set status='a;b';DELETE FROM plugin_data.csf_profiles;COMMIT;`,
  );
  assert.deepEqual(
    writes.map((write) => write.table),
    [table, "plugin_data.csf_profiles"],
  );
});
test("reviewed statement hashes stay exact", () => {
  const files = [
    "20260917090000_csf_officer_application_editor_and_note_visibility.sql",
    "20260917100000_csf_graduated_cohort_retention.sql",
    "20260917150000_csf_course_retention_coverage.sql",
  ];
  const found = [];
  for (const file of files) {
    const sql = readFileSync(
      new URL(`../../supabase/migrations/${file}`, import.meta.url),
      "utf8",
    );
    found.push(...topLevelDataWrites(sql));
  }
  for (const entry of reviewedMigrationDataWrites)
    assert.ok(
      found.some(
        (write) =>
          write.statement === entry.statement && write.table === entry.table,
      ),
    );
});

test("statement boundaries ignore semicolons in literals and comments before DO bodies", () => {
  const sql = `SELECT ';'; /* ; */ DO $body$ BEGIN UPDATE public.organization_plugin_installs SET status='active'; END $body$; CREATE FUNCTION fixture() RETURNS void AS $fn$ BEGIN UPDATE public.organization_plugin_installs SET status='active'; END $fn$ LANGUAGE plpgsql;`;
  const writes = prohibitedDataWrites(sql);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, "public.organization_plugin_installs");
});

for (const [label, body] of [
  ["IF", `IF true THEN INSERT INTO ${table} VALUES (1); END IF;`],
  [
    "ELSE",
    `IF false THEN PERFORM 1; ELSE INSERT INTO ${table} VALUES (1); END IF;`,
  ],
  [
    "LOOP",
    `FOR counter IN 1..2 LOOP INSERT INTO ${table} VALUES (1); END LOOP;`,
  ],
  [
    "EXCEPTION",
    `BEGIN PERFORM 1; EXCEPTION WHEN OTHERS THEN INSERT INTO ${table} VALUES (1); END;`,
  ],
])
  test(`detects DO writes after ${label}`, () => {
    const sql = `DO $body$ BEGIN PERFORM 1; ${body} END $body$;`;
    assert.equal(prohibitedDataWrites(sql).length, 1);
    assert.equal(unreviewedDataWrites(sql).length, 1);
  });

test("control-flow text in function bodies and DO strings remains excluded", () => {
  const sql = `CREATE FUNCTION fixture() RETURNS void AS $fn$ BEGIN PERFORM 1; IF true THEN INSERT INTO ${table} VALUES (1); END IF; END $fn$ LANGUAGE plpgsql; DO $body$ BEGIN PERFORM 1; RAISE NOTICE 'IF true THEN INSERT INTO ${table} VALUES (1)'; END $body$;`;
  assert.deepEqual(topLevelDataWrites(sql), []);
});

for (const wrapper of [
  "EXPLAIN ANALYZE",
  "explain (analyze true, verbose true)",
  "EXPLAIN (ANALYZE, FORMAT JSON)",
  "EXPLAIN",
])
  test(`conservatively reviews writes behind ${wrapper}`, () => {
    const sql = `${wrapper} INSERT INTO ${table} VALUES (1);`;
    assert.equal(topLevelDataWrites(sql).length, 1);
    assert.equal(unreviewedDataWrites(sql).length, 1);
    assert.equal(prohibitedDataWrites(sql).length, 1);
    assert.deepEqual(topLevelDataWrites(`${wrapper} SELECT 1;`), []);
  });
