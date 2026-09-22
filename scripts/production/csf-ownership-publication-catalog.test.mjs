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
const before = JSON.parse(read("./final-schema-646.json"));
const after = JSON.parse(read("./final-schema-647.json"));
const versions = expectedVersions(repository).slice(0, 647);
const name = "20260922032811_publish_dvhs_csf_1_2_66";
const sql = read(`../../supabase/migrations/${name}.sql`);

test("CSF ownership review release publication preserves the reviewed database schema", () => {
  assert.equal(versions.length, 647);
  assert.equal(versions.at(-1), "20260922032811");
  assert.deepEqual(after.objects, before.objects);
  assert.equal(after.inventory, before.inventory);
  assert.notEqual(after.ledger, before.ledger);
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 646)));
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
        "SET latest_version = '1.2.66'",
        "SET latest_version = '99.0.0'",
      ),
    ),
    ["public.plugins"],
  );
});

test("an accepted 646 ledger receives only the new publication", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 646),
  );
  assert.equal(prepared.prefix.length, 646);
  assert.match(prepared.query, /'20260922032811','publish_dvhs_csf_1_2_66'/u);
  assert.ok(
    !prepared.query.includes(
      "'20260921020100','csf_reviewed_application_homonyms'",
    ),
  );
  assert.deepEqual(prohibitedDataWrites(prepared.query), []);
  assert.deepEqual(unreviewedWriteTables(prepared.query), []);
});
