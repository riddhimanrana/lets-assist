import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { migrationDigests } from "./migration-digests.mjs";
import { maintenanceTarget } from "./maintenance-preflight.mjs";
import { publicImageStorageCatalog } from "./public-image-storage-catalog.mjs";
import { accountDeletionStorageCatalog } from "./account-deletion-storage-catalog.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";

const root = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(root).slice(0, 708);
const migrationNames = readdirSync(`${root}supabase/migrations`)
  .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
  .sort();
const historicalNames = migrationNames.slice(0, 708);
const manifest = JSON.parse(
  readFileSync(new URL("./final-schema-708.json", import.meta.url), "utf8"),
);

function historicalRoot(t) {
  const fixture = mkdtempSync(join(tmpdir(), "lets-assist-catalog-708-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const migrations = join(fixture, "supabase/migrations");
  mkdirSync(migrations, { recursive: true });
  for (const name of historicalNames) {
    copyFileSync(
      join(root, "supabase/migrations", name),
      join(migrations, name),
    );
  }
  return fixture;
}

test("the observed708 ledger accepts exact migration bytes and all managed boundary guards", (t) => {
  assert.equal(versions.length, 708);
  assert.equal(versions.at(-1), "20261008040000");
  assert.equal(manifest.objects.length, 1364);
  assert.deepEqual(maintenanceTarget(historicalRoot(t)), versions);
  assert.equal(
    acceptedCatalogQuery("untrusted predecessor", versions),
    publicImageStorageCatalog(
      accountDeletionStorageCatalog(
        csfSubmissionDeletionCatalog(finalSchemaCatalog(manifest, versions)),
      ),
    ),
  );
  const names = historicalNames;
  assert.equal(names.length, 708);
  assert.ok(names.every((name) => Object.hasOwn(migrationDigests, name)));
  for (const name of names)
    assert.equal(
      createHash("sha256")
        .update(readFileSync(`${root}supabase/migrations/${name}`))
        .digest("hex"),
      migrationDigests[name],
      name,
    );
});

test("maintenance refuses unreviewed tails in both the live tree and an isolated fixture", (t) => {
  if (migrationNames.some((name) => !Object.hasOwn(migrationDigests, name))) {
    assert.throws(
      () => maintenanceTarget(root),
      /migration bytes are not reviewed/u,
    );
  }
  const fixture = historicalRoot(t);
  writeFileSync(
    join(fixture, "supabase/migrations/20990101000000_unapproved_fixture.sql"),
    "-- Synthetic unapproved migration.\nSELECT 1;\n",
  );
  assert.throws(
    () => maintenanceTarget(fixture),
    /migration bytes are not reviewed/u,
  );
});

test("maintenance refuses changed bytes in the frozen708 ledger", (t) => {
  const fixture = historicalRoot(t);
  const changed = join(fixture, "supabase/migrations", historicalNames.at(-1));
  writeFileSync(
    changed,
    `${readFileSync(changed, "utf8")}\n-- Fixture change.\n`,
  );
  assert.throws(
    () => maintenanceTarget(fixture),
    /migration bytes are not reviewed/u,
  );
});

test("708 adds only the reviewed guard, image cleanup and organization objects", () => {
  const old = JSON.parse(
    readFileSync(new URL("./final-schema-702.json", import.meta.url), "utf8"),
  );
  const before = new Map(
    old.objects.map((entry) => [entry.identity, entry.digest]),
  );
  const after = new Map(
    manifest.objects.map((entry) => [entry.identity, entry.digest]),
  );
  assert.ok([...before.keys()].every((key) => after.has(key)));
  const added = [...after.keys()].filter((key) => !before.has(key));
  assert.equal(added.length, 13);
  for (const key of added)
    assert.match(
      key,
      /(?:public_image|enforce_application_request_write_fence|guard_organization_profile_write|manage_organization_staff_invite)/u,
    );
  assert.equal(
    [...after.keys()].filter(
      (key) => before.has(key) && before.get(key) !== after.get(key),
    ).length,
    43,
  );
});

test("future, partial and changed ledgers remain unaccepted", () => {
  for (const ledger of [
    versions.slice(0, 707),
    [...versions, "20990101000000"],
    [...versions.slice(0, -1), "20990101000000"],
  ])
    assert.throws(() => acceptedCatalogQuery("", ledger));
  assert.throws(() => finalSchemaCatalog(manifest, versions.slice(0, 707)));
});

test("the public-image decorator pins hooks, enabled RLS and every reviewed policy field", () => {
  const sql = publicImageStorageCatalog("SELECT 1;");
  for (const required of [
    "auth.users",
    "storage.objects",
    "public_image_auth_reference",
    "public_image_upload_fence",
    "t.tgenabled='O'",
    "pg_get_triggerdef",
    "relrowsecurity",
    "count(*)=21",
    "20e8c7d6bee8e6de48c1cab4343e12fe",
    "pg_catalog.to_jsonb(c)",
    "storage_object_policy_contract_violations()",
  ])
    assert.ok(sql.includes(required), required);
});
