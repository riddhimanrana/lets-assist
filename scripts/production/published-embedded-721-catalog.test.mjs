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
).filter((version) => version <= "20261009080001");
const manifest = JSON.parse(
  readFileSync(new URL("./final-schema-721.json", import.meta.url), "utf8"),
);

test("the CSF publication retains the reviewed schema and paused Speech and Debate", () => {
  assert.equal(versions.length, 721);
  const previous = JSON.parse(
    readFileSync(new URL("./final-schema-720.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(manifest.objects, previous.objects);
  const query = acceptedCatalogQuery("", versions);
  assert.ok(
    query.includes(
      finalSchemaCatalog(manifest, versions).replace(/;\s*$/u, ""),
    ),
  );
  assert.match(query, /NOT is_active/u);
  assert.ok(query.includes('"version":"1.2.87"'));
  assert.ok(query.includes('"version":"2.0.3"'));
  assert.ok(query.includes("2c55aba805d50a981d1bc50c0755dcde5c7830ca"));
  assert.ok(query.includes("d100831bd2fe3374715de20510d9ae2a77dcfba8"));
  assert.match(query, /to_jsonb\(release\) @> expected.identity/u);
  assert.match(
    query,
    /catalog.latest_version IS DISTINCT FROM release.version/u,
  );
  assert.match(
    query,
    /catalog.code_reference IS DISTINCT FROM release.commit_sha/u,
  );
  for (const field of [
    "sbom_digest",
    "signer_identity",
    "release_inputs",
    "supported_install_contracts",
  ]) {
    assert.ok(query.includes(`"${field}":`));
  }
});

test("CSF publication acceptance binds migration bytes and refuses another ledger", () => {
  const name = "20261009080001_publish_dvhs_csf_1_2_87.sql";
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
      acceptedCatalogQuery("", [...versions.slice(0, -1), "20261009080003"]),
    /explicit release review/u,
  );
});
