import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import {
  approvedMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";
import {
  prohibitedDataWrites,
  topLevelDataWrites,
  unreviewedWriteTables,
} from "./migration-data-writes.mjs";

const repository = new URL("../../", import.meta.url).pathname;
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-649.json"));
const after = JSON.parse(read("./final-schema-650.json"));
const versions = expectedVersions(repository).slice(0, 650);
const name = "20260922081309_publish_dvhs_csf_1_2_68";
const sql = read(`../../supabase/migrations/${name}.sql`);

test("CSF calendar and read-recovery publication preserves the reviewed database schema", () => {
  assert.equal(versions.length, 650);
  assert.equal(versions.at(-1), "20260922081309");
  assert.deepEqual(after.objects, before.objects);
  assert.equal(after.inventory, before.inventory);
  assert.notEqual(after.ledger, before.ledger);
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 649)));
  assert.throws(
    () => acceptedCatalogQuery("", [...versions, "20990101000000"]),
    /explicit release review/u,
  );
});

test("publication permits only the signed catalog statements", () => {
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(
    topLevelDataWrites(sql).map(({ operation, table }) => [operation, table]),
    [
      ["INSERT", "public.plugin_versions"],
      ["UPDATE", "public.plugins"],
    ],
  );
  assert.deepEqual(prohibitedDataWrites(sql), []);
  assert.deepEqual(unreviewedWriteTables(sql), []);
  assert.deepEqual(
    unreviewedWriteTables(
      sql.replace(
        "SET latest_version = '1.2.68'",
        "SET latest_version = '99.0.0'",
      ),
    ),
    ["public.plugins"],
  );
});

test("an accepted 649 ledger receives only the new publication", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 649),
  );
  assert.equal(prepared.prefix.length, 649);
  assert.match(prepared.query, /'20260922081309','publish_dvhs_csf_1_2_68'/u);
  assert.ok(
    !prepared.query.includes(
      "'20260921020100','csf_reviewed_application_homonyms'",
    ),
  );
  assert.deepEqual(prohibitedDataWrites(prepared.query), []);
  assert.deepEqual(unreviewedWriteTables(prepared.query), []);
});
