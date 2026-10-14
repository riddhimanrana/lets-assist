import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { migrationDigests } from "./migration-digests.mjs";
import { productionHotfixManifest } from "./production-hotfix-catalog.mjs";
import {
  exactLedger,
  productionHotfixLedgers,
  productionHotfixVersion,
} from "./production-hotfix-ledger.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";

const root = resolve(import.meta.dirname, "../..");
const target = expectedVersions(root);
const ledgers = productionHotfixLedgers(target);
const read = (name) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const reviewed725 = read("./final-schema-725.json");
const changedIdentities = [
  "function:plugin_data.csf_assert_activity_earning_award(",
  "function:plugin_data.csf_begin_point_submission_authority_base_20260810(",
  "relation:plugin_data.csf_point_submissions",
];

test("the Production hotfix row is the exact tracked SQL, without history repair", () => {
  assert.equal(target[724], productionHotfixVersion);
  const filename = "20261013071100_csf_repeatable_pending_activity_claims.sql";
  const sql = readFileSync(resolve(root, "supabase/migrations", filename));
  assert.equal(
    createHash("sha256").update(sql).digest("hex"),
    migrationDigests[filename],
  );
  assert.equal(ledgers.before.length, 688);
  assert.equal(ledgers.after.length, 689);
  assert.deepEqual(
    ledgers.after.filter((version) => version === productionHotfixVersion),
    [productionHotfixVersion],
  );
});

test("the two nonprefix manifests change only migration 725's three catalog objects", () => {
  const hot = new Map(
    reviewed725.objects.map((row) => [row.identity, row.digest]),
  );
  for (const [count, versions] of [
    [687, ledgers.before],
    [688, ledgers.after],
  ]) {
    const baseline = read(`./final-schema-${count}.json`);
    const manifest = productionHotfixManifest(versions);
    const changed = manifest.objects.filter(
      (row, index) => row.digest !== baseline.objects[index].digest,
    );
    assert.equal(manifest.objects.length, baseline.objects.length);
    assert.deepEqual(
      manifest.objects.map((row) => row.identity),
      baseline.objects.map((row) => row.identity),
    );
    assert.deepEqual(
      changed.map((row) => row.identity),
      baseline.objects
        .filter((row) =>
          changedIdentities.some((identity) =>
            row.identity.startsWith(identity),
          ),
        )
        .map((row) => row.identity),
    );
    assert.equal(changed.length, 3);
    for (const row of changed) {
      if (row.identity === "relation:plugin_data.csf_point_submissions") {
        // The index is rebuilt on the older 687 relation. Its catalog digest
        // was measured read-only on Production's exact 687+725 state; the
        // clean 725 replay includes later columns and has another digest.
        assert.equal(row.digest, "eaeb217d9e5591f190679ac2c37c37ce");
      } else assert.equal(row.digest, hot.get(row.identity));
    }
    assert.equal(
      acceptedCatalogQuery("", versions),
      csfSubmissionDeletionCatalog(finalSchemaCatalog(manifest, versions)),
    );
  }
});

test("only exact reviewed order can select a hotfix catalog", () => {
  assert.ok(exactLedger(ledgers.before, ledgers.before));
  assert.ok(exactLedger(ledgers.after, ledgers.after));
  for (const mutated of [
    [...ledgers.before].reverse(),
    [...ledgers.before, productionHotfixVersion],
    [...ledgers.before.slice(0, -1), "20261013071101"],
  ]) {
    assert.ok(!exactLedger(mutated, ledgers.before));
    assert.throws(
      () => acceptedCatalogQuery("", mutated),
      /explicit release review/u,
    );
  }
});
