import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  expectedVersions,
  productionRef,
  readJson,
  ReleaseCheckError,
  safeFailureMessage,
  verifyLedger,
  verifySchema,
} from "./app-release-checks.mjs";

import { approvedMigrations } from "./forward-migration-allowlist.mjs";
export { approvedMigrations } from "./forward-migration-allowlist.mjs";

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const ledgerQuery =
  "SELECT version::text FROM supabase_migrations.schema_migrations ORDER BY version;";

export function prepareMigration(cwd, read = readFileSync, appliedVersions) {
  const versions = expectedVersions(cwd);
  const tail = approvedMigrations.map(([name]) => name.slice(0, 14));
  if (JSON.stringify(versions.slice(-tail.length)) !== JSON.stringify(tail))
    throw new ReleaseCheckError("The accepted migration tail is not approved.");
  const minimumPrefix = versions.slice(0, -tail.length);
  const prefix = appliedVersions ?? minimumPrefix;
  if (prefix.length < minimumPrefix.length || prefix.length > versions.length)
    throw new ReleaseCheckError(
      "Production migration sequence differs from the reviewed tail.",
    );
  verifyLedger(
    prefix.map((version) => ({ version })),
    versions.slice(0, prefix.length),
  );
  const statements = approvedMigrations.map(([name, hash]) => {
    const sql = read(
      resolve(cwd, "supabase/migrations", `${name}.sql`),
      "utf8",
    );
    if (createHash("sha256").update(sql).digest("hex") !== hash)
      throw new ReleaseCheckError("Approved migration bytes changed.");
    // Keep each migration body inside the transaction that also records its
    // exact ledger version.
    const body = sql
      .replace(/^BEGIN;[ \t]*\r?\n/mu, "")
      .replace(/\s*COMMIT;\s*$/u, "");
    return `${body}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements)
      VALUES (${literal(name.slice(0, 14))},${literal(name.slice(15))},ARRAY[${literal(sql)}]);`;
  });
  const query = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_catalog.pg_advisory_xact_lock(592042, 1);
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
LOCK TABLE app_private.csf_release_worker_controls IN SHARE MODE;
${prefix.includes("20260914033117") ? "LOCK TABLE plugin_data.csf_publication_notification_deliveries IN SHARE MODE;" : ""}
DO $release_guard$ BEGIN
  ${
    prefix.includes("20260914033117")
      ? `IF EXISTS (SELECT 1 FROM plugin_data.csf_publication_notification_deliveries WHERE status='processing' AND lease_expires_at>now()) THEN
    RAISE EXCEPTION 'Wait for publication notification leases to drain';
  END IF;`
      : ""
  }
  IF EXISTS (SELECT 1 FROM app_private.csf_release_worker_controls
    WHERE workbook_refresh OR import_commit OR communications OR scheduled_post_publisher
      OR coalesce((to_jsonb(csf_release_worker_controls)->>'publication_notifications')::boolean,false)) THEN
    RAISE EXCEPTION 'Disable CSF workers before applying schema changes';
  END IF;
  IF (SELECT array_agg(version::text ORDER BY version) FROM supabase_migrations.schema_migrations)
    IS DISTINCT FROM ARRAY[${prefix.map(literal).join(",")}]::text[] THEN
    RAISE EXCEPTION 'Production migration ledger changed';
  END IF;
END $release_guard$;
${statements.slice(prefix.length - minimumPrefix.length).join("\n")}
COMMIT;`;
  return { versions, prefix, query };
}

export async function applyForwardMigrations(config, fetcher = fetch) {
  if (config.projectRef !== productionRef || !config.token)
    throw new ReleaseCheckError("Invalid Production database binding.");
  let prepared = prepareMigration(config.cwd);
  const request = (sql, writable = false) =>
    readJson(
      `https://api.supabase.com/v1/projects/${productionRef}/database/query${writable ? "" : "/read-only"}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      },
      fetcher,
    );
  const observedLedger = await request(ledgerQuery);
  if (!Array.isArray(observedLedger))
    throw new ReleaseCheckError(
      "Production migration sequence differs from the reviewed tail.",
    );
  prepared = prepareMigration(
    config.cwd,
    readFileSync,
    observedLedger.map((row) => row.version),
  );
  const posture = await request(`SELECT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticator'
      AND 'default_transaction_read_only=on'=ANY(coalesce(rolconfig,ARRAY[]::text[]))
  ) AND NOT EXISTS (SELECT 1 FROM app_private.csf_release_worker_controls
    WHERE workbook_refresh OR import_commit OR communications OR scheduled_post_publisher
      OR coalesce((to_jsonb(csf_release_worker_controls)->>'publication_notifications')::boolean,false)) AS valid;`);
  if (posture?.length !== 1 || posture[0].valid !== true)
    throw new ReleaseCheckError(
      "Production has an unresolved write block or an enabled CSF worker.",
    );
  let responseLost = false;
  try {
    if (prepared.prefix.length < prepared.versions.length)
      await request(prepared.query, true);
  } catch {
    // Never resend a mutation. The exact ledger settles a lost response.
    responseLost = true;
  }
  try {
    verifyLedger(await request(ledgerQuery), prepared.versions);
    await verifySchema(config, fetcher);
    const controls = await request(`SELECT
      has_function_privilege('service_role','public.read_csf_release_worker_controls(text)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.read_csf_release_worker_controls(text)','EXECUTE')
      AND NOT has_function_privilege('anon','public.read_csf_release_worker_controls(text)','EXECUTE')
      AND NOT has_function_privilege('service_role','app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)','EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM app_private.csf_release_worker_controls
        WHERE workbook_refresh OR import_commit OR communications OR scheduled_post_publisher
      OR coalesce((to_jsonb(csf_release_worker_controls)->>'publication_notifications')::boolean,false))
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='plugin_data'
        AND table_name='csf_profile_accounts' AND column_name='connection_basis') AS valid;`);
    if (controls?.length !== 1 || controls[0].valid !== true)
      throw new ReleaseCheckError(
        "Production migration postconditions failed.",
      );
  } catch (error) {
    throw new ReleaseCheckError(
      `Migration outcome requires ledger and catalog reconciliation. No automatic retry was made. ${safeFailureMessage(error)}`,
    );
  }
  return {
    migrations: prepared.versions.length,
    head: prepared.versions.at(-1),
    applied: prepared.versions.slice(prepared.prefix.length),
    responseLost,
    catalog: "verified",
    workers: "disabled",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(
        await applyForwardMigrations({
          projectRef: process.env.SUPABASE_PROJECT_ID,
          token: process.env.SUPABASE_ACCESS_TOKEN,
          cwd: process.cwd(),
        }),
      ),
    );
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  }
}
