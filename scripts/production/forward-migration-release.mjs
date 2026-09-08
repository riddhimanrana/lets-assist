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

// This controller approves only these reviewed, backward-compatible migrations.
export const approvedMigrations = [
  [
    "20260907000344_retire_csf_scheduled_publishing",
    "249f7baa75fe8fb0677781677ef2f560aaaa0684edf3a8ef1fc85207a8e7f78b",
  ],
  [
    "20260908020559_csf_requirement_source_evidence",
    "68939485d2ea31b9e65b7853f1918dbecb36e7f6d2ca547da5ee8274a9882464",
  ],
  [
    "20260908075029_csf_workbook_import_recovery_request",
    "c703d28cd0d7d2968944c0bdb3dd623508cefb441cb4ec7ad86813c3d462ad13",
  ],
  [
    "20260908081328_csf_application_source_review_period",
    "9af9de1529b0bcbc39a1d137e9c7292f7808698adf0ab512d954354b52bfee30",
  ],
  [
    "20260908084338_csf_reviewed_workbook_profile_links",
    "91946abbb6c305716060bc185bc5516ebb0ae2a590652adb4018831489718e73",
  ],
  [
    "20260908090508_csf_sheet_automatic_update_authorization",
    "73208262cd29811406d047d4a7dc5a2f040b2baefb7a1a9f531c8ff9bb1f308d",
  ],
  [
    "20260908135756_csf_reviewed_workbook_link_merge_ownership",
    "da88367fb65b095f2206718c156ded7e4c40073ebbf410546ff2b2e868b2e342",
  ],
  [
    "20260908141739_csf_workbook_matching_tab_authorization",
    "c364e525e909d2f4c7213e45a0b18b39a337dcf744b9ceb0995a0fe8265d78d3",
  ],
];

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const ledgerQuery =
  "SELECT version::text FROM supabase_migrations.schema_migrations ORDER BY version;";

export function prepareMigration(cwd, read = readFileSync) {
  const versions = expectedVersions(cwd);
  const tail = approvedMigrations.map(([name]) => name.slice(0, 14));
  if (JSON.stringify(versions.slice(-tail.length)) !== JSON.stringify(tail))
    throw new ReleaseCheckError("The accepted migration tail is not approved.");
  const prefix = versions.slice(0, -tail.length);
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
DO $release_guard$ BEGIN
  IF EXISTS (SELECT 1 FROM app_private.csf_release_worker_controls
    WHERE workbook_refresh OR import_commit OR communications OR scheduled_post_publisher) THEN
    RAISE EXCEPTION 'Disable CSF workers before applying schema changes';
  END IF;
  IF (SELECT array_agg(version::text ORDER BY version) FROM supabase_migrations.schema_migrations)
    IS DISTINCT FROM ARRAY[${prefix.map(literal).join(",")}]::text[] THEN
    RAISE EXCEPTION 'Production migration ledger changed';
  END IF;
END $release_guard$;
${statements.join("\n")}
COMMIT;`;
  return { versions, prefix, query };
}

export async function applyForwardMigrations(config, fetcher = fetch) {
  if (config.projectRef !== productionRef || !config.token)
    throw new ReleaseCheckError("Invalid Production database binding.");
  const prepared = prepareMigration(config.cwd);
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
  verifyLedger(await request(ledgerQuery), prepared.prefix);
  const posture = await request(`SELECT NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticator'
      AND 'default_transaction_read_only=on'=ANY(coalesce(rolconfig,ARRAY[]::text[]))
  ) AND NOT EXISTS (SELECT 1 FROM app_private.csf_release_worker_controls
    WHERE workbook_refresh OR import_commit OR communications OR scheduled_post_publisher) AS valid;`);
  if (posture?.length !== 1 || posture[0].valid !== true)
    throw new ReleaseCheckError(
      "Production has an unresolved write block or an enabled CSF worker.",
    );
  let responseLost = false;
  try {
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
        WHERE workbook_refresh OR import_commit OR communications OR scheduled_post_publisher)
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='plugin_data'
        AND table_name='csf_profile_accounts' AND column_name='connection_basis') AS valid;`);
    if (controls?.length !== 1 || controls[0].valid !== true)
      throw new ReleaseCheckError(
        "Production migration postconditions failed.",
      );
  } catch {
    throw new ReleaseCheckError(
      "Migration outcome requires ledger and catalog reconciliation. No automatic retry was made.",
    );
  }
  return {
    migrations: prepared.versions.length,
    head: prepared.versions.at(-1),
    applied: approvedMigrations.map(([name]) => name.slice(0, 14)),
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
