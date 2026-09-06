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
    "20260906013133_csf_class_import_identity_review_rows",
    "aaaaa70214f9f8d8d0c8488b08932c8346f488d398826abeb59e1939a3100cdc",
  ],
  [
    "20260906024707_csf_officer_annotation_review",
    "3bd48f12a0c99a1aa5948a6b647ef16c18a674c8ca7cf506c01019b432022a80",
  ],
  [
    "20260906025852_csf_pending_identity_reconciliation",
    "bad7e0dd1331ad6e1cae04bc11152553c34218ed189aaa8e159b2994cb9a6542",
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
    const body = sql.replace(/^BEGIN;\s*/u, "").replace(/\s*COMMIT;\s*$/u, "");
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
