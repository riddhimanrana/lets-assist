import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";
import {
  prohibitedDataWrites,
  unreviewedWriteTables,
} from "./migration-data-writes.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-635.json"));
const after = JSON.parse(read("./final-schema-638.json"));
const versions = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).filter((version) => version <= "20260921020100");
const prior = new Map(before.objects.map((row) => [row.identity, row.digest]));

test("student matching binds the signed publication and two reviewed migration versions", () => {
  assert.equal(versions.length, 638);
  assert.deepEqual(versions.slice(-3), [
    "20260921015005",
    "20260921020000",
    "20260921020100",
  ]);
  assert.equal(after.inventory, before.inventory);
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 635)));
  assert.throws(
    () => acceptedCatalogQuery("", [...versions, "20990101000000"]),
    /explicit release review/u,
  );
});

test("matching changes only the batch refusal and reviewed profile helpers", () => {
  assert.deepEqual(
    after.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  assert.deepEqual(
    after.objects
      .filter((row) => prior.get(row.identity) !== row.digest)
      .map((row) => row.identity.split("(")[0]),
    [
      "function:plugin_data.csf_commit_import_row_batch_unserialized",
      "function:plugin_data.csf_create_profile_for_application_import_row_legacy",
    ],
  );
});

test("matching migrations are byte-pinned and do not change live records", () => {
  for (const name of [
    "20260921015005_publish_dvhs_csf_1_2_59",
    "20260921020000_csf_import_application_refusal_receipt",
    "20260921020100_csf_reviewed_application_homonyms",
  ]) {
    const sql = read(`../../supabase/migrations/${name}.sql`);
    assert.deepEqual(
      approvedMigrations.find(([entry]) => entry === name),
      [name, createHash("sha256").update(sql).digest("hex")],
    );
    assert.deepEqual(prohibitedDataWrites(sql), []);
    assert.deepEqual(unreviewedWriteTables(sql), []);
  }
});
