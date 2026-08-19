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

const PRODUCTION_HEAD = "20260811001500";
const TARGET_HEAD = "20260819030000";
const HARD_FAIL_STATEMENT = "SELECT 1 / 0 AS preflight_check_failed;";
const HARD_FAIL_SITES = 31;
const hardFailStatements =
  preflight.match(/^[ \t]*SELECT 1 \/ 0 AS preflight_check_failed;$/gmu) ?? [];
const PENDING_VERSIONS = [
  "20260811063522",
  "20260811073000",
  "20260811074518",
  "20260811081506",
  "20260811085048",
  "20260811100000",
  "20260811110000",
  "20260811120000",
  "20260811132454",
  "20260811160000",
  "20260811161000",
  "20260811170000",
  "20260811180000",
  "20260811233646",
  "20260812010529",
  "20260812030000",
  "20260812065621",
  "20260812071500",
  "20260812072357",
  "20260812073000",
  "20260812100000",
  "20260812100100",
  "20260812100200",
  "20260812100300",
  "20260812100400",
  "20260812100500",
  "20260812100600",
  "20260812100700",
  "20260812100800",
  "20260812100900",
  "20260812101000",
  "20260812101100",
  "20260812104754",
  "20260812114638",
  "20260812115556",
  "20260812132725",
  "20260812152300",
  "20260812161500",
  "20260812185500",
  "20260812193329",
  "20260812193400",
  "20260812203000",
  "20260812203500",
  "20260812220000",
  "20260813010000",
  "20260813012206",
  "20260813013000",
  "20260813013100",
  "20260813013200",
  "20260813013300",
  "20260813020000",
  "20260813085442",
  "20260813091801",
  "20260814001123",
  "20260814051720",
  "20260815100500",
  "20260815110000",
  "20260815120000",
  "20260815130000",
  "20260816083000",
  "20260816185321",
  "20260816190000",
  "20260816190454",
  "20260816230000",
  "20260816233000",
  "20260817010000",
  "20260817020000",
  "20260817021000",
  "20260817022000",
  "20260817030000",
  "20260817040000",
  "20260817050000",
  "20260817100000",
  "20260817110500",
  "20260817114700",
  "20260817120000",
  "20260817121000",
  "20260817130000",
  "20260817131000",
  "20260817132000",
  "20260817133000",
  "20260818040246",
  "20260818064000",
  "20260818074500",
  "20260818092855",
  "20260818115000",
  "20260818134000",
  "20260818150000",
  "20260818160000",
  "20260818170000",
  "20260818180000",
  "20260818223637",
  "20260818232541",
  "20260819002500",
  "20260819020000",
  "20260819030000",
] as const;

function readMigration(version: string) {
  const name = readdirSync(migrationsRoot).find((entry) =>
    entry.startsWith(`${version}_`),
  );
  if (!name) throw new Error(`Migration ${version} is missing`);
  return readFileSync(join(migrationsRoot, name), "utf8");
}

describe("Production cutover preflight source contract", () => {
  test("pins the exact 236 -> 332 ledger and all 96 pending versions", () => {
    const migrations = readdirSync(migrationsRoot)
      .filter((name) => /^\d{14}_.+\.sql$/u.test(name))
      .sort();
    const pending = migrations
      .map((name) => name.slice(0, 14))
      .filter((version) => version > PRODUCTION_HEAD);
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

    expect(migrations).toHaveLength(332);
    expect(migrations.at(0)?.slice(0, 14)).toBe("20260325181408");
    expect(migrations.at(-1)?.slice(0, 14)).toBe(TARGET_HEAD);
    expect(pinnedBaseline).toEqual(
      migrations.slice(0, 236).map((name) => name.slice(0, 14)),
    );
    expect(pending).toEqual([...PENDING_VERSIONS]);
    expect(pinnedTargetTail).toEqual([...PENDING_VERSIONS]);
    expect(preflight).toContain("count(*) = 236");
    expect(preflight).toContain("count(*) = 332");
    expect(preflight).toContain("min(version::text) = '20260325181408'");
    expect(preflight).toContain("96 migrations pending");
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
      "plugin_data_isolation_pass",
      "csf_control_plane_pass",
      "d1_pass",
      "d2_pass",
      "d3_pass",
      "d4_pass",
      "d5_pass",
      "d6_pass",
      "d7_pass",
      "d8_pass",
      "d9_pass",
      "d10_pass",
      "target_shape_ready",
      "t2_pass",
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
    expect(preflight).toContain(
      "private.anonymous_feedback_email_preferences",
    );
    expect(preflight).toContain(
      "set_anonymous_feedback_email_opt_out(uuid,boolean)",
    );
    expect(preflight).toContain(
      "apply_anonymous_feedback_email_preference()",
    );
    expect(preflight).toContain(
      "anonymous_signups_feedback_normalized_email_idx",
    );
    expect(preflight).toContain("trigger_record.tgfoid");
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
      "Missing/partial CSF fails before any CSF table is queried",
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

  test("covers the known data-dependent blockers in the pending ledger", () => {
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
    expect(preflight).toContain("Duplicate active reusable class links");

    expect(readMigration("20260812100000")).toContain(
      "organizations_username_not_reserved_check",
    );
    expect(preflight).toContain(
      "Existing organization uses reserved route slug",
    );

    expect(readMigration("20260812100400")).toContain(
      "project_cancellation_jobs_attempts_bound",
    );
    expect(readMigration("20260812100500")).toContain(
      "legacy_job_parked_before_atomic_claims",
    );
    expect(preflight).toContain(
      "Rows deliberately transitioned by pending cancellation migrations",
    );

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
      "Reviewed public client grants still effective",
    );
    const d10GuardPrefix = [
      "\\if :baseline_ledger",
      "  \\echo ''",
      "  \\echo '=============================================================='",
      "  \\echo 'D10 Reviewed public client grants still effective'",
    ].join("\n");
    const d10BaselineGuard = preflight.indexOf(d10GuardPrefix);
    const d10Index = preflight.indexOf(
      "D10 Reviewed public client grants still effective",
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
      preflight.indexOf("D10 Reviewed public client grants"),
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
  },
);
