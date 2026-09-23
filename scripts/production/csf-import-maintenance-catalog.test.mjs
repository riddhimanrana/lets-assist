import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";
import { topLevelDataWrites } from "./migration-data-writes.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-659.json"));
const after = JSON.parse(read("./final-schema-661.json"));
const versions = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).slice(0, 661);

test("maintenance and history guards replace only the three reviewed functions", () => {
  assert.equal(after.objects.length, before.objects.length);
  assert.deepEqual(
    after.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  const changed = after.objects.filter(
    (row, index) => row.digest !== before.objects[index].digest,
  );
  assert.equal(changed.length, 3);
  assert.deepEqual(
    changed.map((row) => row.digest).sort(),
    [
      "105f4c25d7af0c726d62f5bd46a874b5",
      "ec326c958701aee7065afc01dc7aa270",
      "41eb317f8feb5770685b599e999be418",
    ].sort(),
  );
  assert.ok(
    changed.some(
      (row) => row.identity === "function:public.process_projects()",
    ),
  );
  assert.ok(
    changed.some((row) =>
      row.identity.startsWith(
        "function:plugin_data.csf_import_class_history_row_identity_base(",
      ),
    ),
  );
  assert.ok(
    changed.some((row) =>
      row.identity.startsWith(
        "function:plugin_data.csf_class_import_review_rows(",
      ),
    ),
  );
});

test("the accepted catalog requires the complete reviewed ledger", () => {
  assert.equal(versions.length, 661);
  assert.equal(versions.at(-1), "20260923011212");
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 660)));
});

test("both forward guards have exact approved bytes and no top-level data writes", () => {
  for (const name of [
    "20260923011054_published_project_status_maintenance",
    "20260923011212_csf_history_import_application_guard",
  ]) {
    const sql = read(`../../supabase/migrations/${name}.sql`);
    assert.deepEqual(
      approvedMigrations.find(([entry]) => entry === name),
      [name, createHash("sha256").update(sql).digest("hex")],
    );
    assert.deepEqual(topLevelDataWrites(sql), []);
  }
});
