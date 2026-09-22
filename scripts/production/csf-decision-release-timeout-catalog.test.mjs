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
const before = JSON.parse(read("./final-schema-654.json"));
const after = JSON.parse(read("./final-schema-655.json"));
const versions = expectedVersions(repository).slice(0, 655);
const name = "20260922135905_csf_reviewed_decision_release_timeout";
const sql = read(`../../supabase/migrations/${name}.sql`);
test("the timeout release changes only the reviewed publication RPC", () => {
  assert.equal(versions.at(-1), "20260922135905");
  assert.deepEqual(
    before.objects.map((row) => row.identity),
    after.objects.map((row) => row.identity),
  );
  assert.deepEqual(
    before.objects
      .filter(
        (old) =>
          after.objects.find((row) => row.identity === old.identity)?.digest !==
          old.digest,
      )
      .map((row) => row.identity),
    [
      "function:plugin_data.csf_release_reviewed_sheet_decisions(p_organization_id uuid, p_actor_user_id uuid, p_term_id uuid, p_request_id uuid, p_expected_review_token text)",
    ],
  );
  assert.equal(
    acceptedCatalogQuery("", versions),
    finalSchemaCatalog(after, versions),
  );
  assert.throws(() => finalSchemaCatalog(after, versions.slice(0, 654)));
});
test("the controller binds the finite timeout migration without chapter or role writes", () => {
  assert.deepEqual(
    approvedMigrations.find(([entry]) => entry === name),
    [name, createHash("sha256").update(sql).digest("hex")],
  );
  assert.deepEqual(topLevelDataWrites(sql), []);
  assert.doesNotMatch(
    sql,
    /ALTER\s+(ROLE|DATABASE)|SET\s+statement_timeout\s*=\s*'0'/iu,
  );
  assert.match(sql, /SET statement_timeout = '60s'/u);
  const prepared = prepareMigration(
    repository,
    readFileSync,
    versions.slice(0, 654),
  );
  assert.equal(prepared.prefix.length, 654);
  assert.match(
    prepared.query,
    /'20260922135905','csf_reviewed_decision_release_timeout'/u,
  );
  assert.deepEqual(
    topLevelDataWrites(prepared.query).filter(
      ({ table }) => table !== "supabase_migrations.schema_migrations",
    ),
    [],
  );
});
