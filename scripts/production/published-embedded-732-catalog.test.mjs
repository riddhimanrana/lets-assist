import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
const root = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(root).filter(
  (version) => version <= "20261012002404",
);
const read = (file) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));

test("the exact signed data-only publication is recognized without accepting future ledgers", () => {
  assert.equal(versions.length, 732);
  assert.equal(versions.at(-1), "20261012002404");
  const query = acceptedCatalogQuery("untrusted", versions);
  for (const value of [
    "1.2.89",
    "f116483844d8bfc04c99899c1e38d501a01be191",
    "sha256:36ffd4e5a5df6e47ee2baf8226a185e8546da8ee88425c75d1974bb563be603d",
    "sha256:c3514cea442bc7e9d41cea5de2e50b0364d5a9130d83c84f22dec5c1a22e0d91",
    "20261011110000",
    "automaticUpdate",
    "project_asset_object_delete_guard",
    "csf_review_name_order",
  ])
    assert.ok(query.includes(value), value);
  assert.ok(!query.includes("untrusted"));
  for (const ledger of [
    [...versions, "20990101000000"],
    [...versions.slice(0, -1), "20261012002405"],
    versions.slice(0, 729),
  ])
    assert.throws(
      () => acceptedCatalogQuery("", ledger),
      /explicit release review/u,
    );
});

test("publication retains the prior731 object inventory and binds only its reviewed migration bytes", () => {
  const before = read("./final-schema-731.json");
  const after = read("./final-schema-732.json");
  assert.deepEqual(after.objects, before.objects);
  assert.equal(after.inventory, before.inventory);
  assert.equal(after.objects.length, 1491);
  const bytes = readFileSync(
    new URL(
      "../../supabase/migrations/20261012002404_publish_dvhs_csf_1_2_89.sql",
      import.meta.url,
    ),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "3e954a254470ec7b1eb861af14a80582c3d22f446d6aaaeb00c37779772d15ea",
  );
  const migration = bytes.toString();
  assert.doesNotMatch(
    migration,
    /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|FUNCTION|POLICY|TRIGGER|SCHEMA)\b/iu,
  );
  assert.doesNotMatch(
    migration,
    /organization_plugin_install(?:s|ations)|plugin_data\./u,
  );
  assert.match(migration, /automaticUpdate":false/u);
  // This is a reviewed expected inventory inherited from731, not a claim that
  // a new732 database replay or normalized measurement has already passed.
});
