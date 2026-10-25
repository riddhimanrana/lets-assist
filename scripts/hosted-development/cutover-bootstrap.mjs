import { settlePreexistingRequestTransactionsSql } from "../production/request-write-fence.mjs";
import { maintenanceLedgerQuery } from "../production/maintenance-preflight.mjs";
import {
  bootstrapPlan,
  bootstrapMutationSql,
  bootstrapVerificationSql,
  bootstrapVersion,
} from "../production/request-fence-bootstrap-plan.mjs";
import { ledgerDigest } from "../production/final-schema-manifest.mjs";
import { requireCondition, target } from "./cutover-authority.mjs";
import { developmentQuery, validateDatabaseUrl } from "./cutover-database.mjs";
export {
  bootstrapPlan,
  bootstrapMutationSql,
  bootstrapVerificationSql,
  bootstrapVersion,
} from "../production/request-fence-bootstrap-plan.mjs";

export function bootstrapWriteFence(config, query = developmentQuery) {
  validateDatabaseUrl(config.databaseUrl);
  const plan = bootstrapPlan(config.cwd);
  const applied = JSON.parse(query(config.databaseUrl, maintenanceLedgerQuery));
  const same = (expected) =>
    JSON.stringify(applied) === JSON.stringify(expected);
  requireCondition(
    same(plan.before) || same(plan.after),
    "Bootstrap accepts only the exact baseline or its already-applied write-fence migration.",
  );
  const changed = same(plan.before);
  if (changed)
    requireCondition(
      query(config.databaseUrl, bootstrapMutationSql(plan)) ===
        "request-fence-bootstrap-applied",
      "The bootstrap transaction did not return its exact receipt.",
    );
  // A committed ledger cannot prove a prior barrier completed after a lost response.
  requireCondition(
    query(
      config.databaseUrl,
      `BEGIN READ ONLY;
SET LOCAL statement_timeout='25s';
${settlePreexistingRequestTransactionsSql}
SELECT 'development-bootstrap-transactions-settled';
COMMIT;`,
    ) === "development-bootstrap-transactions-settled",
    "The bootstrap legacy request barrier is unproven.",
  );
  requireCondition(
    query(
      config.databaseUrl,
      `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=public,extensions;
SET LOCAL statement_timeout='120s';
${bootstrapVerificationSql(plan.after)}
SELECT 'development-bootstrap-verified';
COMMIT;`,
    ) === "development-bootstrap-verified",
    "The installed bootstrap catalog or quiescence could not be verified.",
  );
  return {
    count: 688,
    head: bootstrapVersion,
    digest: ledgerDigest(plan.after),
    changed,
  };
}

export async function probeReadAvailability(config, fetcher = fetch) {
  const headers = { apikey: config.serverKey };
  if (config.serverKey.startsWith("eyJ"))
    headers.Authorization = `Bearer ${config.serverKey}`;
  const response = await fetcher(
    `https://${target.database}.supabase.co/rest/v1/system_banners?select=id&and=(id.eq.00000000-0000-0000-0000-000000000000,id.neq.00000000-0000-0000-0000-000000000000)`,
    {
      headers,
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    },
  );
  requireCondition(
    response.ok && (await response.text()) === "[]",
    "The fresh zero-row Data API read did not succeed.",
  );
}
