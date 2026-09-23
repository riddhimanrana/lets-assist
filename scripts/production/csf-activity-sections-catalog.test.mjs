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
const before = JSON.parse(read("./final-schema-656.json"));
const after = JSON.parse(read("./final-schema-657.json"));
const versions = expectedVersions(repository).slice(0, 657);
const name = "20260922232103_csf_activity_sections_and_directory_status";
const sql = read(`../../supabase/migrations/${name}.sql`);
test("the activity release changes only the reviewed layout, directory and Calendar objects", () => {
  assert.equal(versions.at(-1), "20260922232103");
  const prior = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    before.objects.filter(
      (row) => !after.objects.some((next) => next.identity === row.identity),
    ),
    [],
  );
  assert.deepEqual(
    after.objects
      .filter((row) => prior.get(row.identity) !== row.digest)
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_edit_activity_layout(p_organization_id uuid, p_term_id uuid, p_actor_user_id uuid, p_request_id uuid, p_expected_revision bigint, p_operation text, p_payload jsonb)",
      "function:plugin_data.csf_list_class_directory_page(p_organization_id uuid, p_term_id uuid, p_cohort_id uuid, p_view text, p_search text, p_account text, p_standing text, p_sort text, p_cursor_primary text, p_cursor_id uuid, p_page_size integer)",
      "function:plugin_data.csf_list_profiles_page(p_organization_id uuid, p_view text, p_search text, p_cohort_id uuid, p_account text, p_standing text, p_sort text, p_cursor_primary text, p_cursor_id uuid, p_page_size integer)",
      "function:plugin_data.csf_personal_calendar_source_is_authorized(p_organization_id uuid, p_user_id uuid, p_source_kind text, p_source_id uuid)",
      "relation:plugin_data.csf_activity_layouts",
      "relation:plugin_data.csf_activity_sections",
      "relation:plugin_data.csf_opportunities",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 656)));
});
test("the controller binds layout storage without changing student records", () => {
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 656),
  );
  assert.equal(prepared.prefix.length, 656);
  assert.match(
    prepared.query,
    /'20260922232103','csf_activity_sections_and_directory_status'/u,
  );
  assert.deepEqual(prohibitedDataWrites(prepared.query), []);
  assert.deepEqual(unreviewedWriteTables(prepared.query), []);
});
