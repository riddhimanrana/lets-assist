import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { maintenanceTarget } from "./maintenance-preflight.mjs";
const root = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(root);
const read = (file) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));

test("the exact signed data-only publication is recognized without accepting future ledgers", () => {
  assert.equal(versions.length, 731);
  assert.equal(versions.at(-1), "20261011224034");
  const query = acceptedCatalogQuery("untrusted", versions);
  for (const value of [
    "1.2.88",
    "4322648cebb79a82d050105910b5c2faf6ee44d8",
    "sha256:780b5a7d9e4f5b87c7bdfc75eb9ea66e635a2a913b7bb1881ef15a295b6c8af0",
    "sha256:a1fbd8ce5009bcc9c99a138fc438cfbc2447fa086d20e92fe02d2b64fa9546ed",
    "20261011110000",
    "automaticUpdate",
    "project_asset_object_delete_guard",
    "csf_review_name_order",
  ])
    assert.ok(query.includes(value), value);
  assert.ok(!query.includes("untrusted"));
  assert.deepEqual(maintenanceTarget(root), versions);
  for (const ledger of [
    [...versions, "20990101000000"],
    [...versions.slice(0, -1), "20261011224035"],
    versions.slice(0, 729),
  ])
    assert.throws(
      () => acceptedCatalogQuery("", ledger),
      /explicit release review/u,
    );
});

test("publication retains the measured730 object inventory and binds only its reviewed migration bytes", () => {
  const before = read("./final-schema-730.json");
  const after = read("./final-schema-731.json");
  assert.deepEqual(after.objects, before.objects);
  assert.equal(after.inventory, before.inventory);
  assert.equal(after.objects.length, 1491);
  const bytes = readFileSync(
    new URL(
      "../../supabase/migrations/20261011224034_publish_dvhs_csf_1_2_88.sql",
      import.meta.url,
    ),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "1719230acb414189156e118b159919524469f6c668549b1356a1905670fa4e8c",
  );
  const migration = bytes.toString();
  assert.doesNotMatch(
    migration,
    /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|FUNCTION|POLICY|TRIGGER|SCHEMA)\b/iu,
  );
  assert.doesNotMatch(
    migration,
    /organization_plugin_installations|plugin_data\./u,
  );
  assert.match(migration, /automaticUpdate":false/u);
  // This is a reviewed expected inventory inherited from730, not a claim that
  // a new731 database replay or normalized measurement has already passed.
});
