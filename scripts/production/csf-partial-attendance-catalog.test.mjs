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
const before = JSON.parse(read("./final-schema-644.json"));
const after = JSON.parse(read("./final-schema-645.json"));
const versions = expectedVersions(repository).slice(0, 645);
const name = "20260922003000_csf_attendance_followup_commit";
const sql = read(`../../supabase/migrations/${name}.sql`);

test("partial attendance repair changes only the internal commit function", () => {
  assert.equal(versions.at(-1), "20260922003000");
  assert.deepEqual(
    after.objects.map(({ identity }) => identity),
    before.objects.map(({ identity }) => identity),
  );
  const previous = new Map(
    before.objects.map(({ identity, digest }) => [identity, digest]),
  );
  assert.deepEqual(
    after.objects
      .filter(({ identity, digest }) => previous.get(identity) !== digest)
      .map(({ identity }) => identity),
    [
      "function:plugin_data.csf_commit_meeting_attendance_import_identity_base(p_organization_id uuid, p_preview_job_id uuid, p_actor_user_id uuid, p_reason text, p_correlation_id uuid, p_evidence_token uuid, p_allow_unresolved boolean)",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 644)));
});

test("the controller applies the exact repair without rewriting live records", () => {
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 644),
  );
  assert.equal(prepared.prefix.length, 644);
  assert.match(
    prepared.query,
    /'20260922003000','csf_attendance_followup_commit'/u,
  );
  assert.deepEqual(topLevelDataWrites(prepared.query), []);
});
