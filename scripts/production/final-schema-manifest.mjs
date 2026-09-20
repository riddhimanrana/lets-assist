import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const finalSchemaInventory = readFileSync(
  new URL("./final-schema-inventory.sql", import.meta.url),
  "utf8",
).trim();
export const ledgerDigest = (versions) =>
  createHash("sha256").update(versions.join("\n")).digest("hex");

export function finalSchemaCatalog(manifest, versions) {
  if (
    manifest.format !== 1 ||
    manifest.ledger !== ledgerDigest(versions) ||
    manifest.inventory !==
      createHash("sha256").update(finalSchemaInventory).digest("hex") ||
    !Array.isArray(manifest.objects) ||
    manifest.objects.length === 0 ||
    new Set(manifest.objects.map((row) => row.identity)).size !==
      manifest.objects.length ||
    manifest.objects.some(
      (row) =>
        typeof row.identity !== "string" || !/^[a-f0-9]{32}$/.test(row.digest),
    )
  ) {
    throw new Error(
      "Final schema manifest does not match the reviewed ledger or inventory contract.",
    );
  }
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const rows = manifest.objects
    .map(({ identity, digest }) => `(${literal(identity)},${literal(digest)})`)
    .join(",\n");
  return `WITH actual AS (${finalSchemaInventory}), expected(identity,digest) AS (VALUES ${rows})
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM actual FULL JOIN expected USING(identity)
  WHERE actual.digest IS DISTINCT FROM expected.digest
) AND NOT EXISTS (
  SELECT 1 FROM plugin_data.csf_class_join_codes code
  JOIN plugin_data.csf_retention_retired_cohorts retired
    ON retired.organization_id=code.organization_id AND retired.cohort_id=code.cohort_id
  WHERE code.status='active'
) AND EXISTS (
  SELECT 1 FROM plugin_data.csf_retention_reference_policy
  WHERE parent_table='csf_profiles' AND child_table='csf_sheet_semester_ledger_writes'
    AND child_column='profile_id' AND policy='delete_with_owner'
) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
