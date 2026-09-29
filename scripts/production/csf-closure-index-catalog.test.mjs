import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";
import { topLevelDataWrites } from "./migration-data-writes.mjs";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-641.json"));
const after = JSON.parse(read("./final-schema-642.json"));
const versions = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).slice(0, 642);
const name = "20260921074528_csf_closure_evidence_read_index";
const sql = read(`../../supabase/migrations/${name}.sql`);

test("the covering index changes only the import-row relation contract", () => {
  const prior = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(after.objects.length, before.objects.length);
  assert.deepEqual(
    after.objects
      .filter((row) => row.digest !== prior.get(row.identity))
      .map((row) => row.identity),
    ["relation:plugin_data.csf_sheet_import_rows"],
  );
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
  assert.doesNotMatch(sql, /DELETE|UPDATE|CREATE.*FUNCTION|REFRESH COLLATION/u);
});
