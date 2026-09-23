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
const before = JSON.parse(read("./final-schema-663.json"));
const after = JSON.parse(read("./final-schema-664.json"));
const versions = expectedVersions(repository).slice(0, 664);
const name = "20260923033010_csf_durable_activity_email_intent";

test("activity email intent extends existing publication and campaign models only", () => {
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  const added = after.objects.filter((row) => !previous.has(row.identity));
  assert.equal(after.objects.length, before.objects.length + 15);
  assert.equal(added.length, 15);
  assert.ok(
    added.every((row) => row.identity.startsWith("function:plugin_data.csf_")),
  );
  const changed = after.objects.filter(
    (row) =>
      previous.has(row.identity) && previous.get(row.identity) !== row.digest,
  );
  assert.deepEqual(
    changed.map((row) => row.identity),
    [
      "relation:plugin_data.csf_communication_campaigns",
      "relation:plugin_data.csf_communication_recipient_snapshots",
      "relation:plugin_data.csf_publication_events",
    ],
  );
  assert.ok(
    before.objects.every((row) =>
      after.objects.some((candidate) => candidate.identity === row.identity),
    ),
  );
});

test("the accepted email intent catalog binds the complete 664 ledger", () => {
  assert.equal(versions.length, 664);
  assert.equal(versions.at(-1), "20260923033010");
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 663)));
});

test("the intent migration has approved bytes and does not backfill publications", () => {
  const sql = read(`../../supabase/migrations/${name}.sql`);
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
});

test("an accepted 663 ledger receives only the activity intent migration", () => {
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 663),
  );
  assert.equal(prepared.prefix.length, 663);
  assert.equal(
    (
      prepared.query.match(
        /INSERT INTO supabase_migrations.schema_migrations/gu,
      ) ?? []
    ).length,
    expectedVersions(repository).length - 663,
  );
  assert.ok(
    prepared.query.includes("csf_finalize_activity_email_preparation_campaign"),
  );
});
