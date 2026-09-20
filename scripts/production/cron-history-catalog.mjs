import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260920010000_bound_cron_execution_history.sql",
    import.meta.url,
  ),
  "utf8",
);
const command = migration.split("$job$")[1];
const digest = createHash("md5").update(command).digest("hex");

export function cronHistoryCatalog(previous) {
  return `SELECT CASE WHEN (${previous.trim().replace(/;$/u, "")}) = 1
    AND (SELECT count(*) = 1 FROM cron.job
      WHERE jobname = 'retain-cron-execution-history'
        AND active AND schedule = '17 * * * *'
        AND username = 'postgres' AND database = current_database()
        AND md5(command) = '${digest}')
    THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
