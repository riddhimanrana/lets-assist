import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";

const read = (name) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const versions = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).slice(0, 723);

test("landing display mode adds only its reviewed private state and service RPCs", () => {
  const before = read("./final-schema-721.json");
  const after = read("./final-schema-723.json");
  const previous = new Map(
    before.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(after.objects.length, before.objects.length + 5);
  assert.equal(after.inventory, before.inventory);
  for (const row of after.objects) {
    if (previous.has(row.identity))
      assert.equal(row.digest, previous.get(row.identity), row.identity);
  }
  assert.deepEqual(
    after.objects
      .filter((row) => !previous.has(row.identity))
      .map((row) => row.identity),
    [
      "function:public.get_landing_demo_mode()",
      "function:public.set_landing_demo_mode(p_enabled boolean, p_expected boolean, p_actor_id uuid)",
      "relation:app_private.landing_demo_events",
      "relation:app_private.landing_demo_events_id_seq",
      "relation:app_private.landing_demo_setting",
    ],
  );
  const query = acceptedCatalogQuery("unused predecessor", versions);
  for (const name of [
    "process-project-statuses",
    "public_image_auth_reference",
    "account_deletion_write_fence",
    "csf_fence_deleted_submission_storage_upload",
    "plugin_versions",
    "csf_retention_reference_policy",
  ]) {
    assert.ok(query.includes(name), name);
  }
});

test("the landing catalog cannot approve changed or future migration ledgers", () => {
  assert.equal(versions.length, 723);
  assert.equal(versions.at(-1), "20261011100000");
  assert.doesNotThrow(() => acceptedCatalogQuery("", versions.slice(0, -1)));
  for (const unreviewed of [
    [...versions.slice(0, -1), "20261011100001"],
    [...versions, "20990101000000"],
  ]) {
    assert.throws(
      () => acceptedCatalogQuery("", unreviewed),
      /explicit release review/u,
    );
  }
});
