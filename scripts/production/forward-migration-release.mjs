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
  [
    "20260913015059_csf_merged_class_history_source_lineage",
    "0228fb574352fd9c4b88dc980aca68241a7a228c832b94ae22277f162302ba94",
  ],
  [
    "20260913031445_allow_published_csf_activity_without_start_date",
    "435e4a59c90ff78928c936b4b5ec67a315565f49e3cfb639ec34f832be8311ba",
  ],
  [
    "20260913053412_publish_dvhs_csf_1_2_38",
    "2ca68ace7855170b57cfd0ba1c87a2b62fc60920a7edba056c9a7b32f84a5b74",
  ],
  [
    "20260913061610_allow_undated_csf_activity_updates",
    "36ebe34107d449defc93ff39d4b477f42c3988352873425ae5e4295b3db56d6c",
  ],
  [
    "20260913070513_publish_dvhs_csf_1_2_39",
    "b11a28e362972c2c3981638d70bdbfaf5df1d1aafc4e7cb6c1c5fb40b5428dc2",
  ],
  [
    "20260913175928_publish_dvhs_csf_1_2_40",
    "ba22016978dac13321996bbbfe2d26e9e70d99f9599c5d1554ef67adaf5efc74",
  ],
  [
    "20260913191541_publish_dvhs_csf_1_2_41",
    "0b3932095ef8df46fdd05a0eb86f22d2560bf53901f6c424df19127929c5057c",
  ],
  [
    "20260913200500_csf_sheet_discussion_write_guard",
    "d3ac255d3b056133985de3fe15b65be6545c24aab2b4af6fcce7f5cdeafb0662",
  ],
  [
    "20260913202237_publish_dvhs_csf_1_2_42",
    "901de8c50b81119fcfc88d99cfbce2413879538f889026a59b3954aad249a7cf",
  ],
  [
    "20260914030902_publish_dvhs_csf_1_2_43",
    "5a07c6077146f60c98493fe15b229681dfd6584197293e150209265d2dbe5600",
  ],
  [
    "20260914033117_csf_publication_notifications",
    "7816de9de5bdbb5e3b8f6dc6ab237bfbbeebae4b84ad9f73fe385b54ab46182e",
  ],
  [
    "20260914044610_add_publication_notification_worker_control",
    "c3f2890be21fadee2ed79bf11d2312875259e4e42dd12e583d1750025510fcad",
  ],
  [
    "20260914062207_publish_dvhs_csf_1_2_44",
    "8873a2c1278baae57f2b7e4f030f88977cc52ceb095430b51e2f15d3d3f07e1c",
  ],
  [
    "20260914072729_publish_dvhs_csf_1_2_45",
    "fe54942f025e774f6e248c126e824e5928da88b0e48f3ce30a1d0807fd923926",
  ],
  [
    "20260914080000_csf_publication_dispatch_acl",
    "661ae934dda627cc39177aed3fccfa6e60ee893d3c1d864b0ef3e4495a0eec19",
  ],
  [
    "20260914120000_csf_flexible_activity_earning_rules",
    "a722096ea175c765750879d1419d3ca4c77566f46f593bfd7eaaace774eeb90f",
  ],
  [
    "20260914130000_csf_review_queue_assignment",
    "b5351cdbd2e9d00d67a67a2511ce71f979d9792f815160c99d2e663cb875ba1e",
  ],
  [
    "20260914150000_csf_manual_application_intake",
    "3e53ea36f97fda8689e96f325d040d435886458420f162dccbcd2a22a75591e0",
  ],
  [
    "20260914160000_csf_notification_delivery_organization_index",
    "0d7cacc28995d243663ad0b4260dbd583ecc0b7987b3f09b83ea49e5c4e35ef1",
  ],
  [
    "20260914170000_csf_application_import_noop_guard",
    "7191b49cdcb96f59c75246428bbf6eebd68a1b5eebb20d9db5a4c4382101484b",
  ],
  [
    "20260915015213_csf_mixed_category_point_resubmission",
    "2978a3a4b303f666a7555a885831cb2e18b10ba8691ce1c1b12c0d437efc9a59",
  ],
  [
    "20260915032757_publish_dvhs_csf_1_2_46",
    "e7cc3a2423fd4a0a623818966ab3db33ca42932f988c25f5a3995419130c4dc3",
  ],
  [
    "20260915050000_csf_earning_ceiling_and_intake_guards",
    "57a28115b92ee554016d4a28a741fb8c72236d118f20e3c1d9b81668633693bd",
  ],
  [
    "20260915051000_csf_native_intake_term_guard",
    "baf56f74593dcca3188894bda55ff720fe457f0493b753a208fb096e372eb1f3",
  ],
  [
    "20260915051713_publish_dvhs_csf_1_2_47",
    "0302c574d2b8cdfa5eb5a62be357a4d24249098e5c56e3514fed97fd5b82d8c7",
  ],
  [
    "20260915054936_csf_fixed_activity_submission_uniqueness",
    "ca0616fa8514351447e652a1a9caf70a6092e5958d9be1cdfa6c98f9552113af",
  ],
  [
    "20260915060928_publish_dvhs_csf_1_2_48",
    "40ceb108b957f2c4872a63532e3d832a626f633b09144b2b68225a61fab25cbc",
  ],
  [
    "20260915152825_csf_history_import_review_guards",
    "43aebb5c25f7de98096959bb3e0ea294e63224a77c28408fa1e5b54b6d5c70e6",
  ],
  [
    "20260915153055_csf_connection_request_identity_guards",
    "82c53d30b804e11b4615dc6e7f071d5a2cf06d2e56b14df9464536e76d59ec78",
  ],
  [
    "20260915161000_csf_fixed_activity_cap_guard",
    "24fb7a766e0f74a138300e9ff3903833f17bdf99e1ea3cc18c0eb57a90ed2191",
  ],
  [
    "20260915161001_publish_dvhs_csf_1_2_49",
    "02eaa178cb565927667196a177a05b385b145bd52f45f3b15148dae4b8df5fde",
  ],
  [
    "20260915161554_csf_resolved_class_request_recovery",
    "12ed82455022245df6360a6db0c7c6cd4b3c95b6eafdeb6545c90d9476949733",
  ],
  [
    "20260915183410_publish_dvhs_csf_1_2_50",
    "4f8a5750f4ac191535847d9784e776795611331716f8da7fc1f887ee3716c03e",
  ],
  [
    "20260915195501_publish_dvhs_csf_1_2_51",
    "78db818f4a65c3b945f826bfb2c8f928fbcf5a6cba4908cd7f6f896ca5b25bce",
  ],
  [
    "20260916000000_csf_typed_name_self_link",
    "5eaa8ee7ec12abe3facb4b6681f60b3c84fcf4aaca00dec080572d7173aaa0f2",
  ],
  [
    "20260916010000_csf_member_reports",
    "50b12757df94b4bfe515becba6312525a4b6b9aa5a286bb1d4a35c54c5d8131b",
  ],
  [
    "20260916040000_csf_officer_identity_authority",
    "b646f11ec1ad3b6652a4b78f341f0175167f78ad252a1323437f285b80968744",
  ],
  [
    "20260916050000_csf_unrecognised_attendance_mark_is_unknown",
    "620411bf69a6e13d40067c2e44ffd321cc77540d26b51ae78fe44698eec9b356",
  ],
  [
    "20260916055000_csf_officer_closed_semester_edits",
    "9523f6d42c54f485cd28f857622e0eb7901fddf005dfe9d1f8670bc83d750fb3",
  ],
  [
    "20260916060000_csf_officer_profile_activity_editing",
    "d6c78052d9f6e104f48740797ebd1a7b39c3f851299e4bbbd2724b6462dc044e",
  ],
  [
    "20260916070000_csf_class_block_acceptance_headers",
    "e5f95d474c7a805214c96898289467f196824ac9e52d82e2cdd24985796d3c27",
  ],
  [
    "20260916080000_csf_officer_edit_review_fixes",
    "5f0cfa7c857e7488c2c2f614caef7f95263012823ac3443aac99f4f284e52051",
  ],
  [
    "20260916090000_csf_officer_decision_replay_and_supersede",
    "9ee43c89e583123bb264b81932fc9f3afe5144816e8b877325c7dea2a469290a",
  ],
  [
    "20260917010000_csf_term_decision_staging",
    "50240d63fef25984bc847637fb4f52e60c1a3497192e09233354c60a579b92cf",
  ],
  [
    "20260917010100_csf_sheet_application_decision_rpcs",
    "e755d58697227ec18c883765f3390a9892740f2e25b1c2bb9ef7e6bfe4d9dfe5",
  ],
  [
    "20260917010200_csf_sheet_application_decision_sync",
    "dd37949e7e7f4e0abd02b8c35ecc94b155566f330cf9936d77cd1290c79124d0",
  ],
  [
    "20260917010300_csf_sheet_application_decision_release",
    "6f10202570069dfc481c23e3f7f5232314d851c6a56af90ddc6560fd259406da",
  ],
  [
    "20260917020000_csf_decision_stage_merge_ownership",
    "e91815f78d2420c38701f8282de098f41b33286abd292a5de84bb7d53b533f66",
  ],
  [
    "20260917020100_csf_application_decision_mapping_fields",
    "dd32eeb78aeae26ac1254607bf95724e4559d2500a18228312ab916e95c2b31d",
  ],
  [
    "20260917030000_csf_finalized_outcome_guard",
    "0bea6a8e91ec661587012bb696a8e6baff65769d8f35cee8d9c3ee14f470530a",
  ],
  [
    "20260917030100_csf_provenance_null_safety",
    "78ea6da08ea6142138bb690e329aec2ee891024218cefda21c08af4c57d695d3",
  ],
  [
    "20260917040000_csf_decision_plan_reset_safe_update",
    "974669e157afc1d7fb041ad42fc2deec27367b021e669298ed08329c095c6b53",
  ],
  [
    "20260917050000_csf_decision_plan_ordinal_safe_update",
    "456e0a170c96e6e6af57cec2d679835775130388a64e89228ee9b5fe47c727c1",
  ],
  [
    "20260917060000_csf_published_decision_reason",
    "d199c0ce03fb29c837ce8fe7f3346e3224abed2c2812f2009502966a83df6a76",
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
