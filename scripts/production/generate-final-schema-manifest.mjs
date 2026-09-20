import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expectedVersions } from "./app-release-checks.mjs";
import {
  finalSchemaInventory,
  ledgerDigest,
} from "./final-schema-manifest.mjs";

export function assertCleanInventory(objects) {
  const fixtureNames = [
    "csf_seed_synthetic_import_fixture",
    "csf_seed_reset_synthetic_import",
    "csf_assert_fixture_owner",
    "csf_assert_fixture_reference",
    "csf_assert_fixture_keys",
    "csf_assert_synthetic_fixture_scope",
    "csf_is_synthetic_fixture_id",
    "csf_test_begin_then_commit_race",
    "csf_test_capture_import_merge_race",
  ];
  if (
    objects.some(({ identity }) =>
      fixtureNames.some((name) =>
        identity.startsWith(`function:plugin_data.${name}(`),
      ),
    )
  ) {
    throw new Error(
      "Local fixture helpers remain in the catalog. Capture an unseeded replay or apply the authoritative fixture teardown before capture.",
    );
  }
}

// Input is catalog metadata from a clean owned replay, never application records.
// psql -Atc "SELECT json_agg(row) FROM (<inventory SQL>) row" > inventory.json
export function generateFinalSchemaManifest(versions, objects) {
  if (!Array.isArray(objects) || objects.length === 0)
    throw new Error("A nonempty catalog inventory is required.");
  return {
    format: 1,
    ledger: ledgerDigest(versions),
    inventory: createHash("sha256").update(finalSchemaInventory).digest("hex"),
    objects: [...objects].sort((a, b) =>
      a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0,
    ),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [cwd, input] = process.argv.slice(2);
  if (!cwd || !input)
    throw new Error(
      "Usage: node generate-final-schema-manifest.mjs <repository> <inventory.json>",
    );
  const objects = JSON.parse(readFileSync(input, "utf8"));
  assertCleanInventory(objects);
  process.stdout.write(
    JSON.stringify(
      generateFinalSchemaManifest(expectedVersions(cwd), objects),
      null,
      2,
    ) + "\n",
  );
}
