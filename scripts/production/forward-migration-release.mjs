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
  [
    "20260911192954_publish_dvhs_csf_1_2_28",
    "29a67a486fce45a0dd2e309674505cbb340ff788bbd9d59e12481beaabf38210",
  ],
  [
    "20260911195446_csf_sheet_sync_review_recovery",
    "2decd1a72195303164c6db1aa4d104261627275e0ef72692ec467e87e5b92137",
  ],
  [
    "20260911201640_publish_dvhs_csf_1_2_29",
    "fb41e61e145e657e2127522e8b4642c1bf4c63b373b3de20dcde4aad74c8278c",
  ],
  [
    "20260911203901_csf_sheet_sync_observation_guard",
    "7c6d30a31b65fa7664577a4038bc45e40d3b3b07cb673065edef980561d66b80",
  ],
  [
    "20260911210549_publish_dvhs_csf_1_2_31",
    "ad0963ff59bbca881b26574d3d8c0344539037d9c4244c91de93ecbeb14a35a8",
  ],
  [
    "20260911211201_csf_defer_profile_note_export",
    "ec7176f9da2b965598fd1f8883c3b8982e66763df569cdf68bfdcb8c3c402da7",
  ],
  [
    "20260911212627_csf_sheet_sync_toggle_observation",
    "c94df97321a8bf77b1a1a9dbbd563e00781f9531f4840ea84150a3f117d715fc",
  ],
  [
    "20260911223137_publish_dvhs_csf_1_2_32",
    "ae4317408bdd9feedba053e0d86e1818a2505087407ffc9ec2ad111a3bbe0874",
  ],
  [
    "20260911223138_csf_application_retry_range_expansion",
    "f9b39f6ab92664d1c6396e8c486a5078d31469a351e96ac739cd123740b6dc0e",
  ],
  [
    "20260911231213_csf_application_retry_canonical_ranges",
    "e0a478c58565c8566a0cc4d0b135e10b7765490280269ef0d4b9cf83ee16caeb",
  ],
  [
    "20260912002546_publish_dvhs_csf_1_2_34",
    "369ef5ec515317b8354bc15f56a2c4050829e73f0d3c92bf390f7b838a334e40",
  ],
  [
    "20260912015112_csf_sheet_no_comments_transport",
    "a7f2e083c67fcc2063c7b49ecb5b8ebc012d444b9a6160e4b8a01b12a24ac463",
  ],
  [
    "20260912015608_csf_member_directory_staff_identity_search",
    "d0699b6cc9c0c05ba2c11122d106d3153ae6dc6efbe71a3ce720ff8217466788",
  ],
  [
    "20260912033551_publish_dvhs_csf_1_2_35",
    "8d8b2c063d638d4479d6c1fed23673566db08a8f0886e0c5c46986f9a18f897c",
  ],
  [
    "20260912064503_publish_dvhs_csf_1_2_36",
    "8a0d5639ae4e28597ee8f0675227b70bad30723200532fe3a931b8126e108cd8",
  ],
  [
    "20260913012424_publish_dvhs_csf_1_2_37",
    "b6f745253fa03a213966e07d213885d394f9f5883b0085d52d83190c2ec01c73",
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
