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
import { topLevelDataWrites } from "./migration-data-writes.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const repository = new URL("../../", import.meta.url).pathname;
const before = JSON.parse(read("./final-schema-662.json"));
const after = JSON.parse(read("./final-schema-663.json"));
const versions = expectedVersions(repository).slice(0, 663);
const name = "20260923033000_csf_history_exclusion_carry_forward";

test("the exclusion guard adds one internal function without changing existing objects", () => {
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  const added = after.objects.filter((row) => !previous.has(row.identity));
  assert.equal(after.objects.length, before.objects.length + 1);
  assert.equal(added.length, 1);
  assert.ok(
    added[0].identity.startsWith(
      "function:plugin_data.csf_carry_forward_history_exclusion(",
    ),
  );
  assert.equal(added[0].digest, "1bfae8f42a64662416bac7e507d6ac0e");
  for (const row of after.objects.filter((row) => previous.has(row.identity)))
    assert.equal(row.digest, previous.get(row.identity));
});

test("the accepted catalog binds the complete 663 ledger", () => {
  assert.equal(versions.length, 663);
  assert.equal(versions.at(-1), "20260923033000");
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 662)));
});

test("the guard has approved immutable bytes and no top-level data writes", () => {
  const sql = read(`../../supabase/migrations/${name}.sql`);
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
});

test("an accepted 662 ledger receives only the exclusion guard", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 662),
  );
  assert.equal(prepared.prefix.length, 662);
  assert.equal(
    (
      prepared.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    expectedVersions(repository).length - 662,
  );
  assert.ok(prepared.query.includes("csf_carry_forward_history_exclusion"));
});
