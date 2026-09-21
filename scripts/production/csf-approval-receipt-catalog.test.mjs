import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import {
  approvedMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";
import { topLevelDataWrites } from "./migration-data-writes.mjs";

const repository = new URL("../../", import.meta.url).pathname;
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-640.json"));
const after = JSON.parse(read("./final-schema-641.json"));
const versions = expectedVersions(repository).slice(0, 641);
const name = "20260921073532_csf_approval_receipt_server_reads";
const sql = read(`../../supabase/migrations/${name}.sql`);

test("approval receipt read grant changes only its two relation contracts", () => {
  assert.equal(versions.length, 641);
  assert.equal(versions.at(-1), "20260921073532");
  assert.equal(after.inventory, before.inventory);
  assert.equal(after.objects.length, before.objects.length);
  const prior = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    after.objects
      .filter((row) => row.digest !== prior.get(row.identity))
      .map((row) => row.identity),
    [
      "relation:plugin_data.csf_automatic_import_approval_rows",
      "relation:plugin_data.csf_automatic_import_approvals",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 640)));
});

test("the forward migration grants only read access and changes no records", () => {
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
  assert.match(
    sql,
    /GRANT SELECT ON plugin_data.csf_automatic_import_approvals,\s+plugin_data.csf_automatic_import_approval_rows TO service_role;/u,
  );
  assert.doesNotMatch(
    sql,
    /GRANT (ALL|INSERT|UPDATE|DELETE)|TO (anon|authenticated|PUBLIC)/u,
  );
  assert.equal(
    prepareMigration(repository, readFileSync, versions.slice(0, 640)).prefix
      .length,
    640,
  );
});
