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
const repository = new URL("../../", import.meta.url).pathname;
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const before = JSON.parse(read("./final-schema-653.json"));
const after = JSON.parse(read("./final-schema-654.json"));
const versions = expectedVersions(repository).slice(0, 654);
const name = "20260922124643_csf_sheet_snapshot_scope_fast_path";
const sql = read(`../../supabase/migrations/${name}.sql`);
test("decision export repair changes only the reviewed snapshot functions", () => {
  assert.equal(versions.at(-1), "20260922124643");
  const changed = before.objects
    .filter(
      (old) =>
        after.objects.find((row) => row.identity === old.identity)?.digest !==
        old.digest,
    )
    .map((row) => row.identity);
  assert.deepEqual(changed, [
    "function:plugin_data.csf_queue_changed_sheet_sync_record()",
    "function:plugin_data.csf_sheet_sync_destination_snapshot_with_discussions(p_organization_id uuid, p_destination_id uuid, p_record_kind text, p_record_id uuid)",
  ]);
  assert.deepEqual(
    after.objects
      .filter(
        (row) => !before.objects.some((old) => old.identity === row.identity),
      )
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_queue_sheet_sync_snapshot_internal(p_organization_id uuid, p_destination_id uuid, p_record_kind text, p_record_id uuid, p_snapshot jsonb)",
    ],
  );
  assert.ok(
    before.objects.every((old) =>
      after.objects.some((row) => row.identity === old.identity),
    ),
  );
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 653)));
});
test("the forward controller applies only the exact performance repair", () => {
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 653),
  );
  assert.equal(prepared.prefix.length, 653);
  assert.match(
    prepared.query,
    /'20260922124643','csf_sheet_snapshot_scope_fast_path'/u,
  );
  assert.ok(
    !prepared.query.includes("'20260922112314','publish_dvhs_csf_1_2_71'"),
  );
  assert.deepEqual(
    topLevelDataWrites(prepared.query).filter(
      ({ table }) => table !== "supabase_migrations.schema_migrations",
    ),
    [],
  );
});
