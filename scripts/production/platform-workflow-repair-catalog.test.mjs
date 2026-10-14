import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { maintenanceTarget } from "./maintenance-preflight.mjs";
import { applyForwardMigrations } from "./forward-migration-release.mjs";
import { platformWorkflowStorageTriggers } from "./platform-workflow-repair-catalog.mjs";

const root = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(root).slice(0, 730);
const read = (name) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const manifest = read("./final-schema-730.json");

test("the reviewed workflow repair ledger retains every prior object", () => {
  const previous = read("./final-schema-723.json");
  const before = new Map(
    previous.objects.map((row) => [row.identity, row.digest]),
  );
  const after = new Map(
    manifest.objects.map((row) => [row.identity, row.digest]),
  );
  assert.equal(versions.length, 730);
  assert.equal(versions.at(-1), "20261011113000");
  assert.equal(manifest.objects.length, 1491);
  assert.equal(manifest.inventory, previous.inventory);
  assert.ok([...before.keys()].every((identity) => after.has(identity)));
  const additions = [...after.keys()].filter(
    (identity) => !before.has(identity),
  );
  assert.equal(additions.length, 52);
  assert.equal(additions.filter((id) => id.startsWith("function:")).length, 46);
  assert.equal(additions.filter((id) => id.startsWith("relation:")).length, 6);
  assert.equal(
    [...before.keys()].filter((id) => before.get(id) !== after.get(id)).length,
    11,
  );
  assert.throws(() => maintenanceTarget(root), /explicit release review/u);
});

test("the workflow catalog preserves prior guards and binds provider-owned hooks", () => {
  const query = acceptedCatalogQuery("untrusted predecessor", versions);
  for (const required of [
    "process-project-statuses",
    "public_image_auth_reference",
    "account_deletion_write_fence",
    "csf_fence_deleted_submission_storage_upload",
    "plugin_versions",
    "csf_retention_reference_policy",
    "csf_review_name_order",
    "c.collowner='postgres'::regrole",
    "c.collprovider='i'",
    "NOT c.collisdeterministic",
    "colliculocale",
    "t.tgenabled='O' AND NOT t.tgisinternal",
  ])
    assert.ok(query.includes(required), required);
  assert.equal(platformWorkflowStorageTriggers.length, 5);
  for (const [name, signature, definition] of platformWorkflowStorageTriggers) {
    assert.ok(query.includes(name), name);
    assert.ok(query.includes(signature), signature);
    assert.ok(query.includes(definition.replaceAll("'", "''")), definition);
  }
});

test("partial, changed and future workflow ledgers remain unaccepted", () => {
  for (const unreviewed of [
    versions.slice(0, 729),
    [...versions.slice(0, -1), "20261011113001"],
    [...versions, "20990101000000"],
  ]) {
    assert.throws(
      () => acceptedCatalogQuery("", unreviewed),
      /explicit release review/u,
    );
    assert.throws(() => finalSchemaCatalog(manifest, unreviewed));
  }
});

test("the integrated candidate cannot use the online migration lane", async () => {
  let requests = 0;
  await assert.rejects(
    applyForwardMigrations(
      {
        cwd: root,
        projectRef: "fotdmeakexgrkronxlof",
        token: "fictional-test-token",
      },
      async () => {
        requests += 1;
        throw new Error("This path must refuse before provider access");
      },
    ),
    /accepted migration tail is not approved/u,
  );
  assert.equal(requests, 0);
});
