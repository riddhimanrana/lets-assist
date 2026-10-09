import assert from "node:assert/strict";
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
import { maintenanceTarget } from "./maintenance-preflight.mjs";
import { publicImageStorageCatalog } from "./public-image-storage-catalog.mjs";
import { accountDeletionStorageCatalog } from "./account-deletion-storage-catalog.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";

const root = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(root).slice(0, 717);
const names = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
  .sort()
  .slice(0, 717);
const manifest = JSON.parse(
  readFileSync(new URL("./final-schema-717.json", import.meta.url), "utf8"),
);

function replayRoot(t) {
  const fixture = mkdtempSync(join(tmpdir(), "lets-assist-catalog-717-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(join(fixture, "supabase/migrations"), { recursive: true });
  for (const name of names)
    copyFileSync(
      join(root, "supabase/migrations", name),
      join(fixture, "supabase/migrations", name),
    );
  return fixture;
}

test("the clean 717 replay accepts exact migration bytes and preserves managed boundary guards", (t) => {
  assert.equal(versions.length, 717);
  assert.equal(versions.at(-1), "20261009060000");
  assert.equal(manifest.objects.length, 1434);
  assert.deepEqual(maintenanceTarget(replayRoot(t)), versions);
  assert.equal(
    acceptedCatalogQuery("untrusted predecessor", versions),
    publicImageStorageCatalog(
      accountDeletionStorageCatalog(
        csfSubmissionDeletionCatalog(finalSchemaCatalog(manifest, versions)),
      ),
    ),
  );
});

test("the integrated replay preserves all prior catalog identities", () => {
  const previous = JSON.parse(
    readFileSync(new URL("./final-schema-716.json", import.meta.url), "utf8"),
  );
  const before = new Map(
    previous.objects.map((row) => [row.identity, row.digest]),
  );
  const after = new Map(
    manifest.objects.map((row) => [row.identity, row.digest]),
  );
  assert.ok([...before.keys()].every((identity) => after.has(identity)));
  assert.equal(
    [...after.keys()].filter((identity) => !before.has(identity)).length,
    0,
  );
  assert.equal(
    [...after.keys()].filter(
      (identity) =>
        before.has(identity) && before.get(identity) !== after.get(identity),
    ).length,
    1,
  );
});

test("maintenance refuses a changed integrated migration or an unreviewed tail", (t) => {
  const fixture = replayRoot(t);
  const file = join(fixture, "supabase/migrations", names.at(-1));
  const original = readFileSync(file, "utf8");
  writeFileSync(file, original + "\n-- Synthetic tamper.\n");
  assert.throws(
    () => maintenanceTarget(fixture),
    /migration bytes are not reviewed/u,
  );
  writeFileSync(file, original);
  writeFileSync(
    join(fixture, "supabase/migrations/20990101000000_unapproved_fixture.sql"),
    "SELECT 1;\n",
  );
  assert.throws(
    () => maintenanceTarget(fixture),
    /migration bytes are not reviewed/u,
  );
});

test("partial and future integrated ledgers have no accepted catalog", () => {
  for (const ledger of [
    versions.slice(0, 714),
    [...versions, "20990101000000"],
    [...versions.slice(0, -1), "20990101000000"],
  ]) {
    assert.throws(() => acceptedCatalogQuery("", ledger));
  }
  assert.throws(() => finalSchemaCatalog(manifest, versions.slice(0, 716)));
});
