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
    "20260909090522_csf_application_grade_preview_evidence",
    "90397200354eb5cfe634ed12d80cf7e85a51cc3d501f7bc7847e913b2a45876b",
  ],
  [
    "20260909090944_csf_application_retry_match_recovery",
    "463bf86ea078eb3869a6b044831adde42c3eacbadf0b765790912cac68b552a2",
  ],
  [
    "20260909161331_csf_hide_archived_classes_from_directory",
    "30a84eec143355b5ac6936264dcda50b41a047e0a229a85a715c522080a955cb",
  ],
  [
    "20260909163547_csf_directory_prefers_active_class",
    "ea50b4be11a5baa8f7cdf122efd31aa617ef8adb7c5523d8a24a4e3af0dfc8a7",
  ],
  [
    "20260909171733_csf_preserve_reported_course_text",
    "ee0c21e1b4e6e8ad5ba901f01b41e257ee11eab48dfec557c2849582c3fd175c",
  ],
  [
    "20260909173201_csf_optional_reported_course_text",
    "1b51af8125170da480aff999acb197e38cfb52dd8e35598ad2459c978a2a1f01",
  ],
  [
    "20260909193538_csf_staff_account_connection",
    "b32650db6162625ba5ab1984ee0737d25f8694d491cdfd2b2d42a7984e7b5148",
  ],
  [
    "20260909193835_csf_staff_account_connection_authority_lock",
    "2ae13fff4d2a54ebdedc3868c4784f1500970c9a8f625f9c5b708feb43cb8fd2",
  ],
  [
    "20260909231613_csf_reopen_application_review",
    "d7cf8d0dfb95a7a45a5047334dc0ada2a0766c920405412a74dd2d0e9d378a63",
  ],
  [
    "20260910004059_csf_import_application_profile_contacts",
    "0f8db9dd0b49e754282f4791779a92a362326c2e5f23da74999ed7de724e3a68",
  ],
  [
    "20260910043037_csf_reported_application_contacts",
    "d9b1861e2a6968f679989827edf8474258b551cc996606e95e07a437e886a9ed",
  ],
  [
    "20260910043106_csf_verified_account_join_policy",
    "d1aeaf5526b990e873575ba0b9d1c46f689da4219ef5cc5c855b6d3f46903e54",
  ],
  [
    "20260910045040_csf_legacy_ownership_review",
    "1242c71a53826a74b84e33f5e5dc9a61dc707ec4f7b75f262f26cf062c57983b",
  ],
  [
    "20260910090800_csf_returning_account_revoked_history",
    "d142eabfcd2ffdcd6e9c665b336d8475f5c8e44e2981ec60a2570d18cc5eb5cd",
  ],
  [
    "20260910232532_csf_sheet_sync_review_queue",
    "7c5d9bf9fe47d17ee27f2bf0a862492218d5f9b0eaa98a7b83f185ad97ffb89d",
  ],
  [
    "20260911101007_publish_dvhs_csf_1_2_25",
    "32cb2d89eca6ce9ac87defdd856973cffc5153cf3c87d8d5d89f513d27a684eb",
  ],
  [
    "20260911130443_publish_dvhs_csf_1_2_26",
    "e1df91aa3e43d85d1fd0553c3a698a5df506bd032fb804249848395f21b2b9b7",
  ],
  [
    "20260911143923_publish_dvhs_csf_1_2_27",
    "8a50c4b036700502129824041acb2a1b68625d66b5fe36c744ec9daf0a34a9a5",
  ],
  [
    "20260911184253_csf_sheet_discussion_transport",
    "e2336fcc15947fa723d4748273708434416cfa0ed07531a3abecfcb8165090d7",
  ],
];

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
    WHERE workbook_refresh OR import_commit OR communications OR scheduled_post_publisher) AS valid;`);
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
