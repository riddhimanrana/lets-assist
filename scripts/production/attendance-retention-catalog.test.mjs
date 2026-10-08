import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { migrationDigests } from "./migration-digests.mjs";

const versions = expectedVersions(
  new URL("../../", import.meta.url).pathname,
).filter((version) => version <= "20261009080000");
const manifest = JSON.parse(
  readFileSync(new URL("./final-schema-720.json", import.meta.url), "utf8"),
);

test("retention acceptance keeps the measured schema, paused offering and signed identities", () => {
  assert.equal(versions.length, 720);
  const query = acceptedCatalogQuery("", versions);
  assert.ok(
    query.includes(
      finalSchemaCatalog(manifest, versions).replace(/;\s*$/u, ""),
    ),
  );
  assert.match(query, /NOT is_active/u);
  assert.ok(query.includes('"version":"1.2.86"'));
  assert.ok(query.includes('"version":"2.0.3"'));
  const previous = JSON.parse(
    readFileSync(new URL("./final-schema-717.json", import.meta.url), "utf8"),
  );
  const before = new Map(
    previous.objects.map((object) => [object.identity, object.digest]),
  );
  assert.equal(manifest.objects.length, previous.objects.length);
  assert.deepEqual(
    manifest.objects
      .filter((object) => before.get(object.identity) !== object.digest)
      .map((object) => object.identity),
    ["relation:private.project_attendance_changes"],
  );
});

test("retention acceptance binds the migration bytes and refuses an unreviewed ledger", () => {
  const name =
    "20261009080000_retain_attendance_corrections_after_account_deletion.sql";
  assert.equal(
    migrationDigests[name],
    createHash("sha256")
      .update(
        readFileSync(
          new URL(`../../supabase/migrations/${name}`, import.meta.url),
        ),
      )
      .digest("hex"),
  );
  assert.throws(
    () =>
      acceptedCatalogQuery("", [...versions.slice(0, -1), "20261009080002"]),
    /explicit release review/u,
  );
});
