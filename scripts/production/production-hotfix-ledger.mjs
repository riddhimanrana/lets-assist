// The already-applied points hotfix is source migration 725. Production applied
// it directly after migration 687; preserve that row while filling the gap.
export const productionHotfixVersion = "20261013071100";
export const productionFenceVersion = "20260929051600";
export const productionHotfixStoredSqlPredicate = `EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version::text = '20261013071100'
    AND name = 'csf_repeatable_pending_activity_claims'
    AND cardinality(statements) = 1
    AND pg_catalog.encode(extensions.digest(statements[1], 'sha256'), 'hex') =
      '694673006e4a8b1d34e7d57469a7c96b41eb50d789c75d613c8c45a876380a00'
)`;

export function productionHotfixLedgers(target) {
  if (
    target[686] !== "20260929051500" ||
    target[687] !== productionFenceVersion ||
    target[724] !== productionHotfixVersion
  )
    throw new Error("Production hotfix ledger source inventory changed.");
  return {
    before: [...target.slice(0, 687), productionHotfixVersion],
    after: [...target.slice(0, 688), productionHotfixVersion],
  };
}

export function exactLedger(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((version, index) => version === expected[index])
  );
}
