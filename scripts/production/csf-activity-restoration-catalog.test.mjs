import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { prepareMigration } from "./forward-migration-release.mjs";
const read = (file) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const before = read("./final-schema-666.json");
const after = read("./final-schema-667.json");
const repository = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(repository).slice(0, 667);

test("restoration changes only the two reviewed activity lifecycle functions", () => {
  const oldObjects = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.deepEqual(
    after.objects.map((row) => row.identity),
    before.objects.map((row) => row.identity),
  );
  const changed = after.objects.filter(
    (row) => oldObjects.get(row.identity) !== row.digest,
  );
  assert.deepEqual(changed.map((row) => row.identity.split("(")[0]).sort(), [
    "function:plugin_data.csf_set_activity_status_locked_impl",
    "function:plugin_data.csf_set_activity_status_with_email",
  ]);
  assert.equal(versions.at(-1), "20260923200000");
  assert.equal(
    acceptedCatalogQuery("invalid predecessor", versions),
    finalSchemaCatalog(after, versions),
  );
});

test("the reviewed restoration migration is pinned in the release transaction", () => {
  const prepared = prepareMigration(repository);
  assert.match(
    prepared.query,
    /'20260923200000','csf_restore_closed_activity'/u,
  );
  assert.match(prepared.query, /Only closed activities can be restored/u);
  assert.match(
    prepared.query,
    /Restoring an activity cannot request another announcement/u,
  );
});
