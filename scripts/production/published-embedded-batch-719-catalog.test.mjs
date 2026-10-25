import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { migrationDigests } from "./migration-digests.mjs";

const root = new URL("../../", import.meta.url).pathname;
const versions = expectedVersions(root).filter((v) => v <= "20261009070001");

test("the signed pair retains the paused catalog and verifies both immutable identities", () => {
  assert.equal(versions.length, 719);
  const previous = acceptedCatalogQuery("", versions.slice(0, -1));
  const current = acceptedCatalogQuery("", versions);
  assert.ok(current.includes(previous.replace(/;\s*$/u, "")));
  assert.match(current, /NOT is_active/u);
  for (const version of ['"version":"2.0.3"', '"version":"1.2.86"']) {
    assert.ok(current.includes(version));
  }
  assert.ok(current.includes("d100831bd2fe3374715de20510d9ae2a77dcfba8"));
  assert.match(current, /to_jsonb\(release\) @> expected.identity/u);
  assert.match(
    current,
    /catalog.latest_version IS DISTINCT FROM release.version/u,
  );
  assert.match(
    current,
    /catalog.code_reference IS DISTINCT FROM release.commit_sha/u,
  );
  for (const field of [
    "sbom_digest",
    "signer_identity",
    "host_api_range",
    "release_inputs",
    "supported_install_contracts",
  ]) {
    assert.ok(current.includes(`"${field}":`));
  }
});

test("the publication acceptance rejects another ledger and binds the migration bytes", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery("", [...versions.slice(0, -1), "20261009070002"]),
    /explicit release review/u,
  );
  const name = "20261009070001_publish_private_plugin_batch.sql";
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
});
