import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const migrationsRoot = join(repositoryRoot, "supabase/migrations");
const preflight = readFileSync(
  join(repositoryRoot, "scripts/production-cutover-preflight.sql"),
  "utf8",
);
const architectureAudit = readFileSync(
  join(repositoryRoot, "scripts/audit-supabase-architecture.sh"),
  "utf8",
);

const PRODUCTION_HEAD = "20260829092823";
const TARGET_HEAD = "20260901230000";
const HARD_FAIL_STATEMENT = "SELECT 1 / 0 AS preflight_check_failed;";
const HARD_FAIL_SITES = 35;
const hardFailStatements =
  preflight.match(/^[ \t]*SELECT 1 \/ 0 AS preflight_check_failed;$/gmu) ?? [];
const PENDING_VERSIONS = [
  "20260830100000",
  "20260830110000",
  "20260830120000",
  "20260830130000",
  "20260830140000",
  "20260831000000",
  "20260831010000",
  "20260831122035",
  "20260831234952",
  "20260901023000",
  "20260901035129",
  "20260901043613",
  "20260901052000",
  "20260901060000",
  "20260901070000",
  "20260901103347",
  "20260901120000",
  "20260901230000",
] as const;

function readMigration(version: string) {
  const name = readdirSync(migrationsRoot).find((entry) =>
    entry.startsWith(`${version}_`),
  );
  if (!name) throw new Error(`Migration ${version} is missing`);
  return readFileSync(join(migrationsRoot, name), "utf8");
}

describe("Production cutover preflight source contract", () => {
  test("pins the exact 414 -> 432 ledger and all 18 pending versions", () => {
    const migrations = readdirSync(migrationsRoot)
      .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
      .sort();
    // The preflight is a frozen record of one cutover: production sat at 414
    // migrations (head PRODUCTION_HEAD) and 18 were pending up to TARGET_HEAD.
    // Bound the window to that cutover instead of everything newer than
    // PRODUCTION_HEAD, so migrations added after it do not retroactively make
    // the record look wrong.
    const pending = migrations
      .map((name) => name.slice(0, 14))
      .filter((version) => version > PRODUCTION_HEAD && version <= TARGET_HEAD);
    const baselineBlock = preflight.slice(
      preflight.indexOf("-- BEGIN EXACT PRODUCTION BASELINE VERSIONS"),
      preflight.indexOf("-- END EXACT PRODUCTION BASELINE VERSIONS"),
    );
    const pinnedBaseline = [...baselineBlock.matchAll(/'(\d{14})'/gu)].map(
      (match) => match[1],
    );
    const targetTailBlock = preflight.slice(
      preflight.indexOf("-- BEGIN EXACT PRODUCTION TARGET TAIL"),
      preflight.indexOf("-- END EXACT PRODUCTION TARGET TAIL"),
    );
    const pinnedTargetTail = [...targetTailBlock.matchAll(/'(\d{14})'/gu)].map(
      (match) => match[1],
    );

    // The cutover's 432-migration target must remain an exact prefix of the
    // ledger. That keeps every pinned version verifiable while the ledger grows
    // past the cutover.
    expect(migrations.length).toBeGreaterThanOrEqual(432);
    expect(migrations.at(0)?.slice(0, 14)).toBe("20260325181408");
    expect(migrations.slice(0, 432).at(-1)?.slice(0, 14)).toBe(TARGET_HEAD);
    expect(pinnedBaseline).toEqual(
      migrations.slice(0, 414).map((name) => name.slice(0, 14)),
    );
    expect(pending).toEqual([...PENDING_VERSIONS]);
    expect(pinnedTargetTail).toEqual([...PENDING_VERSIONS]);
    expect(preflight).toContain("count(*) = 414");
    expect(preflight).toContain("count(*) = 432");
    expect(preflight).toContain("min(version::text) = '20260325181408'");
    expect(preflight).toContain("18 migrations pending");
    expect(preflight).not.toContain("count(*) = 295");
    for (const version of PENDING_VERSIONS) {
      expect(preflight).toContain(`'${version}'`);
    }
  });

  test("contains only read-only SQL and fail-closed psql controls", () => {
    const executableLines = preflight
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"));
    expect(
      executableLines.filter((line) => /^\s*BEGIN\b/iu.test(line)),
    ).toEqual(["BEGIN TRANSACTION READ ONLY;"]);
    expect(preflight).toContain('psql -X "$PRODUCTION_READONLY_URL"');
    expect(
      executableLines.filter((line) => /^\s*ROLLBACK\b/iu.test(line)),
    ).toEqual(["ROLLBACK;"]);
    const checkLines = executableLines.filter(
      (line) =>
        !/^\s*(?:BEGIN TRANSACTION READ ONLY|ROLLBACK);?\s*$/iu.test(line),
    );
    const forbiddenSql =
      /^\s*(?:alter|begin|call|comment|commit|copy|create|delete|do|drop|grant|insert|merge|notify|refresh|reindex|reset|revoke|set|truncate|update|vacuum)\b/iu;
    expect(checkLines.filter((line) => forbiddenSql.test(line))).toEqual([]);
    const statementSource = executableLines
      .map((line) => {
        if (/^\s*\\gset\b/u.test(line)) return ";";
        if (line.trimStart().startsWith("\\")) return "";
        return line;
      })
      .join("\n")
      .replace(/'(?:''|[^'])*'/gu, "''");
    const statements = statementSource
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(
      statements.filter(
        (statement) =>
          /^\s*WITH\b/iu.test(statement) &&
          /\b(?:DELETE|INSERT|MERGE|UPDATE)\b/iu.test(statement),
      ),
    ).toEqual([]);
    expect(
      statements.filter(
        (statement) =>
          /^\s*(?:SELECT|WITH)\b/iu.test(statement) &&
          /\bSELECT\b[\s\S]*?\bINTO\b/iu.test(statement),
      ),
    ).toEqual([]);

    const allowedMeta =
      /^\s*\\(?:echo|elif|else|endif|gset|if|pset|quit|set|timing)\b/u;
    const metaLines = executableLines.filter((line) =>
      line.trimStart().startsWith("\\"),
    );
    expect(metaLines.filter((line) => !allowedMeta.test(line))).toEqual([]);
    expect(preflight).toContain("\\set ON_ERROR_STOP on");
    expect(preflight).toContain(
      "current_setting('transaction_read_only') = 'on'",
    );
    expect(preflight).not.toContain("\\quit");
    expect(hardFailStatements).toHaveLength(HARD_FAIL_SITES);
    expect([...new Set(hardFailStatements.map((line) => line.trim()))]).toEqual(
      [HARD_FAIL_STATEMENT],
    );
    for (const blockingCheck of [
      "read_only_transaction",
      "baseline_shape_ready",
      "csf_shape_ready",
      "csf_column_shape_ready",
      "plugin_data_isolation_pass",
      "csf_control_plane_pass",
      "d1_pass",
      "d2_pass",
      "d3_pass",
      "d4_pass",
      "d5_pass",
      "d11_pass",
      "d12_pass",
      "d7_pass",
      "d8_pass",
      "d9_pass",
      "d10_pass",
      "target_shape_ready",
      "t2_pass",
      "target_csf_release_tail_pass",
      "target_google_cap_rpc_pass",
      "target_pg_graphql_absent",
      "target_read_models_pass",
      "target_function_acl_pass",
      "target_relation_acl_pass",
      "target_storage_contract_pass",
      "target_import_lineage_pass",
      "target_post_outcome_resolver_pass",
      "e1_pass",
      "e2_pass",
      "e6_pass",
    ]) {
      expect(preflight).toContain(`\\if :${blockingCheck}`);
    }
    expect(preflight).not.toContain("expect 49 rows");
    expect(preflight).not.toContain("The CSF surface must NOT exist");
    expect(preflight).not.toContain("ROWS THIS CUTOVER WILL DELETE");
  });

  test("carries the repository security gates into the target preflight", () => {
    const functionAclBlock = architectureAudit.slice(
      architectureAudit.indexOf("public_client_function_acl_drift="),
      architectureAudit.indexOf(
        "summary=",
        architectureAudit.indexOf("public_client_function_acl_drift="),
      ),
    );
    const expectedClientFunctions = [
      ...functionAclBlock.matchAll(
        /\('([^']+\([^']*\))', '(anon|authenticated)'\)/gu,
      ),
    ].map((match) => [match[1], match[2]]);

    const preflightFunctionAclBlock = preflight.slice(
      preflight.indexOf("T5  Public read-model and function ACL posture"),
      preflight.indexOf("T6  Exact target relation ACL"),
    );
    const preflightClientFunctions = [
      ...preflightFunctionAclBlock.matchAll(
        /\('([^']+\([^']*\))',\s*'(anon|authenticated)'\)/gu,
      ),
    ].map((match) => [match[1], match[2]]);

    expect(expectedClientFunctions.length).toBeGreaterThan(0);
    expect(preflightClientFunctions).toEqual(expectedClientFunctions);
    expect(preflight).toContain("S1  plugin_data RLS and browser isolation");
    expect(preflight).toContain("NOT relation.relrowsecurity");
    expect(preflight).toContain(
      "has_schema_privilege(client.role_name, namespace.oid, 'USAGE')",
    );
    expect(preflight).toContain(
      "has_function_privilege(client.role_name, function_record.oid, 'EXECUTE')",
    );
    expect(preflightFunctionAclBlock).toContain("security_invoker=true");
    expect(preflightFunctionAclBlock).toContain("function_record.prosecdef");

    const privateDvAclMigration = readMigration("20260813091801");
    for (const helperName of ["is_dv_student", "can_access_dv_household"]) {
      expect(privateDvAclMigration).toContain(
        `REVOKE ALL ON FUNCTION private.${helperName}(uuid)`,
      );
      expect(privateDvAclMigration).toContain(
        `GRANT EXECUTE ON FUNCTION private.${helperName}(uuid)`,
      );
    }
    expect(privateDvAclMigration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(
      privateDvAclMigration.match(/TO authenticated, postgres;/gu),
    ).toHaveLength(2);

    const issuerGuard = readMigration("20260812193400");
    expect(issuerGuard).toContain(
      "CREATE OR REPLACE FUNCTION private.protect_staff_join_token_issuer()",
    );
    expect(issuerGuard).toMatch(
      /NEW\.staff_join_token_issued_by\s+IS DISTINCT FROM OLD\.staff_join_token_issued_by/u,
    );
    expect(issuerGuard).toContain(
      "REVOKE ALL ON FUNCTION private.protect_staff_join_token_issuer()",
    );
    expect(issuerGuard).toContain("TO postgres;");
  });

  test("T8 proves the begin lock order and denies every non-owner base caller", () => {
    const t8 = preflight.slice(
      preflight.indexOf("T8  Central import lineage"),
      preflight.indexOf("T9  CSF post-mutation outcome resolver"),
    );
    expect(t8).toContain("pg_catalog.pg_get_functiondef(wrapper.oid)");

    const orderedCalls = [
      "PERFORM plugin_data.csf_lock_identity_mutation(p_organization_id);",
      "PERFORM plugin_data.csf_assert_import_actor_for_job(",
      "PERFORM plugin_data.csf_lock_active_import_profiles(",
      "RETURN plugin_data.csf_begin_import_row_for_attempt_identity_base(",
    ];
    for (const call of orderedCalls) {
      expect(t8).toContain(`'${call}'`);
    }
    for (let index = 0; index < orderedCalls.length - 1; index += 1) {
      expect(t8).toContain(
        `begin_boundary.wrapper_definition,\n        '${orderedCalls[index]}'\n      ) < pg_catalog.strpos(\n        begin_boundary.wrapper_definition,\n        '${orderedCalls[index + 1]}'`,
      );
    }

    const baseSignature =
      "plugin_data.csf_begin_import_row_for_attempt_identity_base(uuid,uuid,uuid)";
    expect(t8).toContain(`'anon',\n        begin_boundary.base_oid`);
    expect(t8).toContain(`'authenticated',\n        begin_boundary.base_oid`);
    expect(t8).toContain("begin_boundary.base_proacl");
    expect(t8).toContain(
      "pg_catalog.acldefault('f', begin_boundary.base_owner)",
    );
    expect(t8).toContain("privilege.grantee = 0");
    expect(t8).toContain("privilege.privilege_type = 'EXECUTE'");
    expect(t8).toContain(`'${baseSignature}'`);
  });

  test("T9 proves the resolver's manage_posts bracket around the same-request lock and denies every non-service caller", () => {
    const migration = readMigration("20260814051720");
    const lockIndex = migration.indexOf(
      "PERFORM pg_catalog.pg_advisory_xact_lock(",
    );
    expect(lockIndex).toBeGreaterThan(0);
    expect(migration).toContain("'plugin_data.csf_post_mutation_request:'");
    expect(migration.slice(0, lockIndex)).toContain("'manage_posts'");
    expect(migration.slice(lockIndex)).toContain("'manage_posts'");
    expect(migration.slice(lockIndex)).toContain(
      "AND audit.correlation_id = p_request_id",
    );
    expect(migration.slice(lockIndex)).toContain(
      "AND audit.source_type = 'post_mutation_request'",
    );
    expect(migration.slice(lockIndex)).toContain(
      "AND audit.actor_user_id = p_actor_user_id",
    );
    expect(migration.slice(lockIndex)).toContain("LIMIT 1");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION plugin_data.csf_resolve_post_mutation_outcome(\n  uuid, uuid, uuid\n) FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION plugin_data.csf_resolve_post_mutation_outcome(\n  uuid, uuid, uuid\n) TO service_role;",
    );

    const t9 = preflight.slice(
      preflight.indexOf("T9  CSF post-mutation outcome resolver"),
      preflight.indexOf("E1  Invalid indexes"),
    );
    expect(t9).toContain(
      "'plugin_data.csf_resolve_post_mutation_outcome(uuid,uuid,uuid)'",
    );
    expect(t9).toContain("pg_catalog.pg_get_functiondef(function_record.oid)");
    expect(t9).toContain("'PERFORM pg_catalog.pg_advisory_xact_lock('");
    expect(t9).toContain("'''plugin_data.csf_post_mutation_request:'''");
    expect(t9).toContain("'''manage_posts'''");
    expect(t9).toContain("after_lock_definition");
    expect(t9).toContain("first_permission_position");
    expect(t9).toContain("'audit.organization_id = p_organization_id'");
    expect(t9).toContain("'audit.correlation_id = p_request_id'");
    expect(t9).toContain("'audit.source_type = ''post_mutation_request'''");
    expect(t9).toContain("'audit.actor_user_id = p_actor_user_id'");
    expect(t9).toContain("'LIMIT 1'");
    expect(t9).toContain(
      "pg_catalog.acldefault('f', resolver_boundary.proowner)",
    );
    expect(t9).toContain("privilege.grantee = 0");
    expect(t9).toContain("privilege.privilege_type = 'EXECUTE'");
    expect(t9).toContain("target_post_outcome_resolver_pass");
    expect(t9).toContain(`'service_role',\n        resolver_boundary.oid`);
    expect(t9).toContain(`'anon',\n        resolver_boundary.oid`);
    expect(t9).toContain(`'authenticated',\n        resolver_boundary.oid`);
  });

  test("T10 pins the bounded service-only feedback candidate read model", () => {
    expect(preflight).toContain("T10 Feedback candidate rotation boundary");
    expect(preflight).toContain("public.project_feedback_candidate_read_model");
    expect(preflight).toContain(
      "private.project_feedback_candidate_end_date(text,jsonb)",
    );
    expect(preflight).toContain("security_invoker=true");
    expect(preflight).toContain("security_barrier=true");
    expect(preflight).toContain(
      "PASS T10: indexed feedback candidate read model and ACLs are exact.",
    );
  });

  test("verifies the moderation evidence shape this cutover introduces", () => {
    const targetShapeBlock = preflight.slice(
      preflight.indexOf("T1  Target-only relation inventory"),
      preflight.indexOf("T3  Target pg_graphql posture"),
    );

    // The relation the reporter pseudonym mapping lives in, the objects that
    // bound retry replay, and the detachment behavior moderation evidence
    // depends on when an account goes away.
    for (const expected of [
      "public.reporter_references",
      "public.api_rate_limit_receipts",
      "api_rate_limit_receipts_expiry_idx",
      "content_reports_request_occurrence_uidx",
      "content_reports_request_fingerprint_format_check",
      "content_reports_request_identity_complete_check",
      "reporter_references_reporter_id_key",
      "content_reports_reporter_id_fkey",
      "content_reports_reporter_reference_fkey",
      "submit_content_report(text,uuid,text,uuid,text,text,integer,text[],integer[],integer)",
      "consume_content_report_attempt(text[],integer[],integer)",
      "detach_content_report_reporter(uuid)",
    ]) {
      expect(targetShapeBlock).toContain(expected);
    }
    expect(targetShapeBlock).toContain("private.project_series_end_receipts");
    expect(targetShapeBlock).toContain("confdeltype");
    expect(targetShapeBlock).toContain("'fk_delete_set_null' THEN 'n'");
    expect(targetShapeBlock).toContain("function_record.prosecdef");
    expect(targetShapeBlock).toContain("ARRAY['search_path=\"\"']");
    expect(targetShapeBlock).toContain(
      "has_function_privilege('service_role', function_record.oid, 'EXECUTE')",
    );

    // The three report functions are server-only, so they must never appear in
    // the client function ACL catalog T5b compares against.
    const functionAclBlock = preflight.slice(
      preflight.indexOf("T5  Public read-model and function ACL posture"),
      preflight.indexOf("T6  Exact target relation ACL"),
    );
    expect(functionAclBlock).not.toContain("submit_content_report");
    expect(functionAclBlock).not.toContain("consume_content_report_attempt");
    expect(functionAclBlock).not.toContain("detach_content_report_reporter");
  });

  test("pins the internal quota helper to its reviewed executor", () => {
    const migration = readMigration("20260812203000");

    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION app_private.consume_rate_limit_buckets(\n  text[], integer[], integer, timestamptz\n) FROM PUBLIC, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION app_private.consume_rate_limit_buckets(\n  text[], integer[], integer, timestamptz\n) TO postgres;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.detach_content_report_reporter(uuid)\n  FROM PUBLIC, anon, authenticated;",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.detach_content_report_reporter(uuid)\n  TO service_role;",
    );
  });

  test("makes moderator alert delivery part of the replay-safe transaction", () => {
    const migration = readMigration("20260812203000");
    const deduplicatedAlertWrites =
      migration.match(
        /ON CONFLICT \(user_id, dedupe_key\) WHERE dedupe_key IS NOT NULL DO NOTHING;/gu,
      ) ?? [];

    expect(migration).toContain("'content-report:' || v_existing_id::text");
    expect(migration).toContain("'content-report:' || v_report_id::text");
    expect(migration).toContain("user_record.raw_app_meta_data");
    expect(deduplicatedAlertWrites).toHaveLength(2);
  });

  test("requires exact target relation and storage contracts", () => {
    expect(preflight).toContain("private.anonymous_feedback_email_preferences");
    expect(preflight).toContain(
      "set_anonymous_feedback_email_opt_out(uuid,boolean)",
    );
    expect(preflight).toContain("apply_anonymous_feedback_email_preference()");
    expect(preflight).toContain(
      "anonymous_signups_feedback_normalized_email_idx",
    );
    expect(preflight).toContain("trigger_record.tgfoid");
    expect(preflight).toContain("trigger_record.tgtype = 23");
    expect(preflight).toContain("trigger_record.tgattr::smallint[]");
    expect(preflight).toContain("'email_opt_out_at'");
    const relationAclBlock = preflight.slice(
      preflight.indexOf("T6  Exact target relation ACL"),
      preflight.indexOf("T7  Exact target storage posture"),
    );
    expect(relationAclBlock).toContain("direct_unexpected");
    expect(relationAclBlock).toContain("effective_unexpected");
    expect(relationAclBlock).toContain("dangerous");
    expect(relationAclBlock).toContain("acl.grantee = 0");

    const storageBlock = preflight.slice(
      preflight.indexOf("T7  Exact target storage posture"),
      preflight.indexOf("E1  Invalid indexes"),
    );
    expect(storageBlock).toContain(
      "app_private.storage_object_policy_contract_violations()",
    );
    expect(storageBlock).toContain(
      "app_private.storage_bucket_posture_catalog()",
    );
    expect(storageBlock).toContain("storage.objects");
    expect(storageBlock).toContain("relrowsecurity");
  });

  test("requires the Google CAP RPC integrity contract", () => {
    expect(preflight).toContain(
      "public.claim_google_cap_event(text,text,text,text,timestamptz,text)",
    );
    expect(preflight).toContain(
      "public.begin_google_cap_event_effect(uuid,uuid,text)",
    );
    expect(preflight).toContain(
      "public.finish_google_cap_event(uuid,uuid,boolean,text,integer,integer)",
    );
    expect(preflight).toContain("target_google_cap_rpc_pass");
    expect(preflight).toContain("function_record.prosecdef");
    expect(preflight).toContain("'search_path=\"\"'");
    expect(preflight).toContain(
      "'service_role',\n          inspected.oid,\n          'EXECUTE'",
    );
    expect(preflight).toContain(
      "private.google_cap_event_receipts_processing_subject_uidx",
    );
    expect(preflight).toContain(
      "'identity_row.provider_id = p_google_subject'",
    );
    expect(preflight).toContain(
      "'v_receipt.resolved_user_id IS DISTINCT FROM v_user_id'",
    );
    expect(preflight).toContain(
      "'status=ANYARRAY[''processing''::text,''effect_started''::text]'",
    );
    expect(preflight).toContain("'effect_fence_index_drift'");
  });

  test("checks CSF control-plane consistency without printing provider secrets", () => {
    const controlPlaneBlock = preflight.slice(
      preflight.indexOf("S2  DVHS CSF control-plane and setup consistency"),
      preflight.indexOf("D1  Duplicate verified certificates"),
    );
    expect(controlPlaneBlock).toContain("public.plugins");
    expect(controlPlaneBlock).toContain(
      "public.organization_plugin_entitlements",
    );
    expect(controlPlaneBlock).toContain("public.organization_plugin_installs");
    expect(controlPlaneBlock).toContain(
      "public.organization_plugin_data_boundaries",
    );
    expect(controlPlaneBlock).toContain("plugin_data.csf_roles");
    expect(controlPlaneBlock).toContain("plugin_data.csf_cohorts");
    expect(controlPlaneBlock).toContain("plugin_data.csf_terms");
    expect(controlPlaneBlock).toContain("'dvhighcsf'");
    expect(controlPlaneBlock).toContain("'dvhs-csf'");
    expect(controlPlaneBlock).toContain("communications_configuration_ready");
    expect(controlPlaneBlock).not.toContain("RESEND_API_KEY");
    expect(controlPlaneBlock).not.toContain("GOOGLE_CLIENT_SECRET");
    expect(controlPlaneBlock).not.toContain("access_token");
    expect(controlPlaneBlock).not.toContain("refresh_token");
  });

  test("guards relation shape before parsing pre- or post-cutover tables", () => {
    const baselineInventory = preflight.slice(
      preflight.indexOf("L1  Baseline relation inventory"),
      preflight.indexOf("S0  CSF relation inventory"),
    );
    expect(baselineInventory).not.toContain("plugin_data.csf_");
    expect(preflight).toContain(
      "Missing/partial CSF fails before any dependent object is queried",
    );
    expect(preflight).toContain("\\if :csf_shape_ready");
    expect(preflight).toContain(
      "no CSF relations are installed on this database",
    );
    expect(preflight).toContain("to_regclass(required.relation_name)");
    expect(preflight).toContain("\\if :baseline_shape_ready");
    expect(preflight).toContain("\\if :target_ledger");
    expect(preflight).toContain("\\if :target_shape_ready");
    expect(preflight).toContain("public.project_cancellation_deliveries");
    expect(preflight).toContain("private.plugin_data_deletion_requests");
    expect(preflight).toContain("private.google_cap_event_receipts");
    expect(
      preflight.indexOf("D7  Cross-organization CSF post replies"),
    ).toBeLessThan(preflight.indexOf("\\if :target_ledger"));
  });

  test("S0 inventories the complete CSF baseline shape used by the tail", () => {
    const s0 = preflight.slice(
      preflight.indexOf("S0  CSF relation inventory"),
      preflight.indexOf("S1  plugin_data RLS and browser isolation"),
    );
    for (const marker of [
      "BEGIN 414 CSF BASELINE RELATIONS",
      "END 414 CSF BASELINE RELATIONS",
      "BEGIN 414 CSF BASELINE FUNCTIONS",
      "END 414 CSF BASELINE FUNCTIONS",
      "BEGIN 414 CSF BASELINE COLUMN SHAPES",
      "END 414 CSF BASELINE COLUMN SHAPES",
    ]) {
      expect(s0).toContain(marker);
    }
    for (const relation of [
      "auth.users",
      "public.organization_members",
      "public.organizations",
      "public.profiles",
      "plugin_data.csf_admin_audit_events",
      "plugin_data.csf_announcement_link_previews",
      "plugin_data.csf_application_correction_requests",
      "plugin_data.csf_class_join_codes",
      "plugin_data.csf_cohorts",
      "plugin_data.csf_meeting_sessions",
      "plugin_data.csf_profile_accounts",
      "plugin_data.csf_sheet_import_commit_attempts",
      "plugin_data.csf_sheet_import_jobs",
      "plugin_data.csf_sheet_import_rows",
      "plugin_data.csf_sheet_sources",
      "plugin_data.csf_term_memberships",
    ]) {
      expect(s0).toContain(`('${relation}'`);
    }
    for (const signature of [
      "extensions.digest(bytea,text)",
      "plugin_data.csf_actor_has_permission(uuid,uuid,text)",
      "plugin_data.csf_assert_import_actor(uuid,uuid,text)",
      "plugin_data.csf_assert_import_actor_for_row(uuid,uuid,uuid)",
      "plugin_data.csf_begin_import_row_for_attempt(uuid,uuid,uuid)",
      "plugin_data.csf_confirm_profile_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text)",
      "plugin_data.csf_import_class_history_row_v2(uuid,uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,text,jsonb,jsonb,boolean,uuid)",
      "plugin_data.csf_import_preview_readiness(uuid,uuid)",
      "plugin_data.csf_join_class_by_code(uuid,text,uuid,text,text,text,text,uuid,uuid)",
      "plugin_data.csf_reconcile_sheet_import_row(uuid,uuid,uuid,text,text,uuid,uuid)",
      "plugin_data.csf_upsert_profile(uuid,uuid,uuid,jsonb)",
    ]) {
      expect(s0).toContain(signature);
    }
    expect(s0).toContain("to_regprocedure(required.signature)");
    expect(s0).toContain("attribute_record.attisdropped");
    expect(s0).toContain("required_function_shapes");
    expect(s0).toContain("function_record.prorettype::regtype::text");
    expect(s0).toContain("invalid_function_shapes");
    expect(s0).toContain("csf_column_shape_ready");
    expect(s0).toContain("csf_missing_columns");
  });

  test("covers current integrity checks and the pending workbook backfill blocker", () => {
    expect(readMigration("20260811073000")).toContain(
      "CSF webhook environment isolation requires every draft campaign",
    );
    expect(preflight).toContain("Open CSF communications missing environment");

    expect(readMigration("20260811081506")).toContain(
      "cannot enforce verified certificate uniqueness",
    );
    expect(preflight).toContain("Duplicate verified certificates per signup");

    expect(readMigration("20260811161000")).toContain(
      "one-active-link-per-class-and-semester index cannot be created",
    );
    expect(preflight).toContain("Duplicate active class join codes");

    expect(readMigration("20260812100000")).toContain(
      "organizations_username_not_reserved_check",
    );
    expect(preflight).toContain(
      "Existing organization uses reserved route slug",
    );

    expect(preflight).toContain(
      "Cancellation-job states and attempts remain valid",
    );
    expect(preflight).not.toContain("accept_state_transitions");

    expect(readMigration("20260812152300")).toContain(
      "csf_announcement_replies_announcement_organization_fkey",
    );
    expect(preflight).toContain("Cross-organization CSF post replies");
    expect(preflight).toContain(
      "Duplicate/unkeyed CSF post-reply request receipts",
    );

    expect(readMigration("20260811132454")).toContain(
      "DROP EXTENSION IF EXISTS pg_graphql RESTRICT",
    );
    expect(preflight).toContain("External dependencies on pg_graphql objects");
    expect(
      preflight.match(
        /SELECT 'pg_catalog\.pg_extension'::regclass AS classid, oid AS objid/gu,
      ),
    ).toHaveLength(2);
    expect(
      preflight.match(/JOIN extension_roots AS referenced_object/gu),
    ).toHaveLength(2);

    const aclMigration = readMigration("20260812100900");
    expect(aclMigration).toContain(
      "client relation ACL catalog preflight found",
    );
    expect(preflight).toContain(
      "Current reviewed public client grants remain effective",
    );
    const d10GuardPrefix = [
      "\\if :baseline_ledger",
      "  \\echo ''",
      "  \\echo '=============================================================='",
      "  \\echo 'D10 Current reviewed public client grants remain effective'",
    ].join("\n");
    const d10BaselineGuard = preflight.indexOf(d10GuardPrefix);
    const d10Index = preflight.indexOf(
      "D10 Current reviewed public client grants remain effective",
      d10BaselineGuard,
    );
    const targetGuard = preflight.indexOf("\\if :target_ledger", d10Index);
    expect(d10BaselineGuard).toBeGreaterThanOrEqual(0);
    expect(d10BaselineGuard).toBeLessThan(d10Index);
    expect(preflight.slice(d10BaselineGuard, targetGuard).trimEnd()).toMatch(
      /\\if :d10_pass[\s\S]*?\\else[\s\S]*?\\endif\n\\endif$/u,
    );
    const migrationAclTriples = [
      ...aclMigration.matchAll(
        /\('([^']+)'::text,\s*'([^']+)'::text,\s*'([^']+)'::text,/gu,
      ),
    ].map((match) => match.slice(1, 4));
    const aclBlock = preflight.slice(
      preflight.indexOf("D10 Current reviewed public client grants"),
      preflight.indexOf("\\if :target_ledger"),
    );
    const preflightAclTriples = [
      ...aclBlock.matchAll(/\('([^']+)','([^']+)','([^']+)',/gu),
    ].map((match) => match.slice(1, 4));
    expect(preflightAclTriples).toEqual(migrationAclTriples);

    function catalogColumns(
      source: string,
      role: "anon" | "authenticated",
      privilege: "INSERT" | "SELECT" | "UPDATE",
      casted: boolean,
    ) {
      const cast = casted ? "::text" : "";
      const pattern = new RegExp(
        String.raw`\('organizations'${cast},\s*'${role}'${cast},\s*'${privilege}'${cast},\s*ARRAY\[([\s\S]*?)\]::text\[\]\)`,
        "u",
      );
      const columns = pattern.exec(source)?.[1];
      expect(columns).toBeDefined();
      return [...(columns ?? "").matchAll(/'([^']+)'/gu)].map(
        (match) => match[1],
      );
    }

    for (const [role, privilege] of [
      ["anon", "SELECT"],
      ["authenticated", "INSERT"],
      ["authenticated", "SELECT"],
      ["authenticated", "UPDATE"],
    ] as const) {
      expect(catalogColumns(aclBlock, role, privilege, false)).toEqual(
        catalogColumns(aclMigration, role, privilege, true),
      );
    }

    const workbookRegistryMigration = readMigration("20260830110000");
    expect(workbookRegistryMigration).toContain(
      "INSERT INTO plugin_data.csf_class_workbooks",
    );
    expect(preflight).toContain(
      "Sheet sources match their graduating-class tenant",
    );
    expect(preflight).toContain(
      "cohort.organization_id IS DISTINCT FROM source.organization_id",
    );
    expect(preflight).toContain("\\if :d11_pass");

    const profileCreationMigration = readMigration("20260831234952");
    expect(profileCreationMigration).toContain(
      "CREATE UNIQUE INDEX csf_class_history_profile_create_request_idx",
    );
    const d12 = preflight.slice(
      preflight.indexOf(
        "D12 Duplicate class-history profile-create request receipts",
      ),
      preflight.indexOf("\\if :target_ledger"),
    );
    expect(d12).toContain("duplicate_request_group_count");
    expect(d12).toContain(
      "audit.action = 'sheet_import.class_history_profile_create_request'",
    );
    expect(d12).toContain("audit.correlation_id IS NOT NULL");
    expect(d12).toContain(
      "GROUP BY audit.organization_id, audit.correlation_id",
    );
    expect(d12).toContain("HAVING count(*) > 1");
    expect(d12).not.toContain("array_agg");
    expect(d12).not.toContain("SELECT audit.organization_id");
    expect(d12).not.toContain("SELECT audit.correlation_id");
    expect(d12).toContain("\\if :d12_pass");
  });

  test("checks every CSF 432 target contract and the final tenant repair", () => {
    const targetInventory = preflight.slice(
      preflight.indexOf("T1  Target-only relation inventory"),
      preflight.indexOf("T2  Target constraints"),
    );
    const targetCsf = preflight.slice(
      preflight.indexOf("T2C 432 CSF release-tail contract"),
      preflight.indexOf("T3  Target pg_graphql posture"),
    );
    const targetRelations = [
      "plugin_data.csf_class_workbooks",
      "plugin_data.csf_class_workbook_refresh_jobs",
      "plugin_data.csf_import_approval_batches",
      "plugin_data.csf_import_commit_queue",
      "plugin_data.csf_import_approval_batch_items",
      "plugin_data.csf_import_row_batches",
      "plugin_data.csf_import_row_batch_outcomes",
    ];
    for (const relation of targetRelations) {
      expect(targetInventory).toContain(relation);
      expect(targetCsf).toContain(relation);
    }

    for (const objectName of [
      "csf_sheet_sources_cohort_organization_fkey",
      "csf_class_workbooks_id_organization_id_key",
      "csf_class_workbooks_cohort_organization_fk",
      "csf_class_workbook_refresh_jobs_source_version_key",
      "csf_class_workbook_refresh_jobs_workbook_organization_fk",
      "csf_import_approval_batches_id_organization_key",
      "csf_import_commit_queue_id_organization_key",
      "csf_import_row_batches_id_organization_key",
      "csf_import_approval_items_batch_organization_fkey",
      "csf_import_approval_items_queue_organization_fkey",
      "csf_import_row_outcomes_batch_organization_fkey",
      "csf_class_workbook_refresh_jobs_claim_idx",
      "csf_class_workbook_refresh_jobs_running_lease_idx",
      "csf_import_commit_queue_claim_idx",
      "csf_import_commit_queue_running_lease_idx",
      "csf_point_submissions_unresolved_queue_idx",
      "csf_point_appeals_unresolved_queue_idx",
      "csf_profiles_name_prefix_idx",
      "csf_profiles_school_email_prefix_idx",
      "csf_profiles_personal_email_prefix_idx",
      "csf_workbook_refresh_jobs_tenant_state_idx",
      "csf_import_approval_items_tenant_batch_idx",
      "csf_import_approval_items_org_queue_idx",
      "csf_import_row_outcomes_tenant_batch_idx",
      "csf_class_history_profile_create_request_idx",
      "csf_sheet_import_rows_attempt_created_profile_resolution",
      "csf_sheet_import_rows_attempt_lineage",
      "csf_import_approval_batches_normalize_status",
      "csf_import_approval_batches_audit",
      "class_workbooks_primary_key",
      "workbook_refresh_jobs_primary_key",
      "import_approval_batches_primary_key",
      "import_commit_queue_primary_key",
      "import_approval_batch_items_primary_key",
      "import_row_batches_primary_key",
      "import_row_batch_outcomes_primary_key",
      "workbook_drive_link_shape",
      "refresh_status_domain",
      "approval_batch_status_domain",
      "commit_queue_status_domain",
      "approval_item_state_domain",
      "row_batch_size_bound",
      "row_outcome_domain",
    ]) {
      expect(targetCsf).toContain(objectName);
    }
    for (const signature of [
      "plugin_data.csf_queue_class_workbook_preparation(uuid,uuid,text,uuid,text,text,jsonb)",
      "plugin_data.csf_queue_import_preview_batch(uuid,uuid,uuid[],uuid)",
      "plugin_data.csf_finish_import_commit_queue(uuid,uuid,text,jsonb,text)",
      "plugin_data.csf_import_row_batch_receipt(uuid,uuid)",
      "plugin_data.csf_commit_import_row_batch(uuid,uuid,uuid,uuid[])",
      "plugin_data.csf_officer_home_snapshot(uuid,uuid)",
      "plugin_data.csf_member_profile_snapshot(uuid,uuid)",
      "plugin_data.csf_import_preview_readiness_batch(uuid,uuid[])",
      "plugin_data.csf_class_history_source_key_value(jsonb)",
      "plugin_data.csf_class_history_source_key_requires_review(uuid,uuid)",
      "plugin_data.csf_create_profile_for_class_history_import_row(uuid,uuid,uuid,uuid,text)",
      "plugin_data.csf_member_home_context_snapshot(uuid,uuid,timestamptz,timestamptz,date)",
      "plugin_data.csf_member_stream_enrichment(uuid,uuid[],uuid[],uuid[])",
      "plugin_data.csf_confirm_class_code_account_name_match(uuid,uuid,uuid,text,uuid,uuid,text,text,text)",
      "plugin_data.csf_queue_import_preview_batch_unserialized(uuid,uuid,uuid[],uuid)",
      "plugin_data.csf_commit_import_row_batch_unserialized(uuid,uuid,uuid,uuid[])",
    ]) {
      expect(targetCsf).toContain(signature);
    }
    expect(targetCsf).toContain("actual_service_privileges");
    expect(targetCsf).toContain("state.actual_service_execute");
    expect(targetCsf).toContain("privilege.grantee = 0");
    expect(targetCsf).toContain("ARRAY['search_path=\"\"']");
    expect(targetCsf).toContain("ON DELETE SET NULL (cohort_id)");
    expect(targetCsf).toContain("ON DELETE SET NULL (queue_id)");
    expect(targetCsf).toContain("target_csf_release_tail_pass");
    expect(targetCsf).toContain("target_csf_release_tail_issues");
    expect(targetCsf).toContain("invalid_constraint_issues");
    expect(targetCsf).toContain("function_order_issues");
    expect(targetCsf).toContain(
      "< pg_catalog.strpos(definition, 'select * into v_batch')",
    );
    for (const retired of [
      "csf_confirm_profile_name_match",
      "csf_join_class_by_code_pre_identity_guard",
      "csf_register_class_workbook",
    ]) {
      expect(targetCsf).toContain(retired);
    }

    const finalMigration = readMigration("20260901230000");
    expect(finalMigration).toContain(
      "DROP FUNCTION IF EXISTS plugin_data.csf_register_class_workbook(",
    );
    expect(finalMigration).toContain(
      "ADD CONSTRAINT csf_sheet_sources_cohort_organization_fkey",
    );
    expect(finalMigration).toContain("ON DELETE SET NULL (cohort_id)");
    expect(finalMigration).toContain(
      "CREATE INDEX csf_import_approval_items_org_queue_idx",
    );
    expect(finalMigration).toContain("WHERE queue_id IS NOT NULL");
    expect(finalMigration).toContain(
      "v_batch.actor_user_id IS DISTINCT FROM p_actor_user_id",
    );
    expect(finalMigration).toContain(
      "v_existing_preview_ids IS DISTINCT FROM v_requested_preview_ids",
    );
    expect(finalMigration).toContain(
      "PERFORM plugin_data.csf_assert_import_actor(",
    );
    expect(
      finalMigration.indexOf("PERFORM plugin_data.csf_assert_import_actor("),
    ).toBeLessThan(finalMigration.indexOf("SELECT * INTO v_batch"));
    expect(finalMigration).toContain(
      "WHERE batch_item.organization_id = v_item.organization_id",
    );
    expect(finalMigration).toContain(
      "AND batch.organization_id = v_item.organization_id",
    );
  });

  test("emits counts instead of live row identifiers for blockers", () => {
    const blockerOutput = preflight.slice(
      preflight.indexOf("D1  Duplicate verified certificates"),
      preflight.indexOf("D10 Current reviewed public client grants"),
    );
    for (const countAlias of [
      "duplicate_signup_group_count",
      "incompatible_campaign_count",
      "duplicate_class_group_count",
      "reserved_slug_organization_count",
      "invalid_cancellation_job_count",
      "cross_tenant_reply_count",
      "invalid_receipt_group_count",
      "external_dependency_count",
    ]) {
      expect(blockerOutput).toContain(countAlias);
    }
    for (const rowProjection of [
      "SELECT signup_id",
      "array_agg(id ORDER BY id)",
      "SELECT campaign.organization_id",
      "SELECT organization_id, cohort_id",
      "SELECT id AS organization_id",
      'SELECT id, status, attempts, "cursor"',
      "SELECT reply.id AS reply_id",
      "SELECT organization_id, correlation_id",
      "pg_catalog.pg_describe_object(",
    ]) {
      expect(blockerOutput).not.toContain(rowProjection);
    }
  });
});

function binaryAvailable(binary: string) {
  return spawnSync(binary, ["--version"], { stdio: "ignore" }).status === 0;
}

const localPostgresAvailable = ["initdb", "pg_ctl", "psql"].every(
  binaryAvailable,
);

function fixtureScript(checkPasses: boolean, failureCommand: string) {
  return `${[
    "\\set ON_ERROR_STOP on",
    "BEGIN TRANSACTION READ ONLY;",
    `SELECT ${checkPasses} AS check_pass`,
    "\\gset",
    "\\if :check_pass",
    "  \\echo 'PASS FIXTURE'",
    "\\else",
    "  \\echo 'FAIL FIXTURE'",
    `  ${failureCommand}`,
    "\\endif",
    "ROLLBACK;",
  ].join("\n")}\n`;
}

function withDisposableCluster(
  assertions: (runFixture: (script: string) => number) => void,
) {
  // The cluster lives in a temporary directory and listens on a unix socket
  // only, so it can never reach or be reached by a hosted database.
  const root = mkdtempSync(join(tmpdir(), "pf-"));
  const dataDirectory = join(root, "d");
  let started = false;
  try {
    const initialized = spawnSync(
      "initdb",
      ["-D", dataDirectory, "-A", "trust", "-U", "postgres", "--no-sync"],
      { stdio: "ignore" },
    );
    if (initialized.status !== 0) {
      throw new Error(
        "initdb could not create the disposable preflight cluster",
      );
    }
    const start = spawnSync(
      "pg_ctl",
      [
        "-D",
        dataDirectory,
        "-o",
        `-k ${root} -c listen_addresses=''`,
        "-w",
        "start",
      ],
      { stdio: "ignore" },
    );
    if (start.status !== 0) {
      throw new Error(
        "pg_ctl could not start the disposable preflight cluster",
      );
    }
    started = true;
    assertions((script) => {
      const scriptPath = join(root, "fixture.sql");
      writeFileSync(scriptPath, script);
      return (
        spawnSync(
          "psql",
          [
            "-X",
            "-h",
            root,
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-f",
            scriptPath,
          ],
          { stdio: "ignore" },
        ).status ?? -1
      );
    });
  } finally {
    if (started) {
      spawnSync(
        "pg_ctl",
        ["-D", dataDirectory, "-w", "-m", "immediate", "stop"],
        {
          stdio: "ignore",
        },
      );
    }
    rmSync(root, { recursive: true, force: true });
  }
}

// Executing the full Production preflight needs a Production-shaped ledger, so
// these tests run the identical hard-fail construct inside the same
// ON_ERROR_STOP / \if guard shape against a throwaway local cluster.
describe.skipIf(!localPostgresAvailable)(
  "Production cutover preflight failure branches abort psql",
  () => {
    test("a FAIL branch exits non-zero, a PASS control path still exits zero, and \\quit 3 would not have failed", () => {
      const [firstHardFail] = hardFailStatements;
      const hardFail = (firstHardFail ?? "").trim();
      expect(hardFail).toBe(HARD_FAIL_STATEMENT);

      withDisposableCluster((runFixture) => {
        expect(runFixture(fixtureScript(false, hardFail))).toBe(3);
        expect(runFixture(fixtureScript(true, hardFail))).toBe(0);
        expect(runFixture(fixtureScript(false, "\\quit 3"))).toBe(0);
      });
    }, 120_000);

    test("the CSF catalog queries parse and execute read-only", () => {
      const s0 = preflight.slice(
        preflight.indexOf("S0  CSF relation inventory"),
        preflight.indexOf("S1  plugin_data RLS and browser isolation"),
      );
      const baselineShapeStart = s0.indexOf("WITH required_columns");
      const baselineShapeQuery = s0
        .slice(baselineShapeStart, s0.indexOf("\\gset", baselineShapeStart))
        .replaceAll(":'baseline_ledger'::boolean", "false");
      const targetCsf = preflight.slice(
        preflight.indexOf("T2C 432 CSF release-tail contract"),
        preflight.indexOf("T3  Target pg_graphql posture"),
      );
      const catalogQuery = targetCsf.slice(
        targetCsf.indexOf("WITH expected_tables"),
        targetCsf.indexOf("  \\gset"),
      );
      expect(baselineShapeQuery).toContain("csf_column_shape_ready");
      expect(catalogQuery).toContain("target_csf_release_tail_pass");

      withDisposableCluster((runFixture) => {
        const script = [
          "\\set ON_ERROR_STOP on",
          "CREATE ROLE anon;",
          "CREATE ROLE authenticated;",
          "CREATE ROLE service_role;",
          "CREATE SCHEMA plugin_data;",
          "BEGIN TRANSACTION READ ONLY;",
          `${baselineShapeQuery};`,
          `${catalogQuery};`,
          "ROLLBACK;",
        ].join("\n");
        expect(runFixture(`${script}\n`)).toBe(0);
      });
    }, 120_000);
  },
);
