import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";

const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const versions = expectedVersions(
  fileURLToPath(new URL("../../", import.meta.url)),
);

test("relation fingerprints sort index definitions independently of database locale", () => {
  const query = acceptedCatalogQuery(source, versions);
  const sorts = query.match(
    /ORDER BY pg_get_indexdef\(i\.indexrelid\) COLLATE "C"/gu,
  );
  assert.ok(sorts && sorts.length >= 3);
  assert.doesNotMatch(
    query,
    /ORDER BY pg_get_indexdef\(i\.indexrelid\)(?! COLLATE "C")/u,
  );
  assert.ok(query.includes("4db39e32056870608efc1d18528f2eef"));
  assert.ok(query.includes("8ea2de3577ed4ae18571aa1a8df986b2"));
});

test("workbook-link merge pins both wrappers and retains the preceding catalog", () => {
  const current = acceptedCatalogQuery(source, versions);
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 466));
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260908135756_csf_reviewed_workbook_link_merge_ownership.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const body of [migration.split("$$")[1], migration.split("$$")[3]]) {
    assert.ok(current.includes(createHash("md5").update(body).digest("hex")));
  }
  assert.ok(
    current.includes("csf_profile_merge_reference_plan_workbook_links_base"),
  );
  assert.ok(current.includes("csf_merge_profiles_workbook_links_base"));
  assert.ok(current.includes("p.provolatile::text=expected.volatility"));
  assert.ok(current.includes("a.grantee='postgres'::regrole"));
  assert.ok(!preceding.includes("csf_merge_profiles_workbook_links_base"));
  assert.ok(preceding.includes("csf_set_sheet_automatic_update_authorization"));
});

test("reviewed workbook links pin functions, permissions, table shape, and request uniqueness", () => {
  const current = acceptedCatalogQuery(source, versions);
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 464));
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260908084338_csf_reviewed_workbook_profile_links.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const body of [
    migration.split("$$")[1],
    migration.split("$$")[3],
    migration.split("$$")[5],
  ]) {
    assert.ok(current.includes(createHash("md5").update(body).digest("hex")));
  }
  assert.ok(
    current.includes("snapshot.digest='4db39e32056870608efc1d18528f2eef'"),
  );
  assert.ok(current.includes("p.proargnames=expected.arguments"));
  assert.ok(
    current.includes("i.indisvalid AND i.indisready AND i.indisunique"),
  );
  assert.ok(current.includes("csf_workbook_profile_link_request_receipt"));
  assert.ok(!preceding.includes("csf_confirm_workbook_profile_link"));
});

test("workbook recovery pins its body and server-only permissions", () => {
  const current = acceptedCatalogQuery(source, versions);
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 462));
  const signature =
    "plugin_data.csf_request_class_workbook_import_recovery(uuid,uuid,uuid,uuid,text)";
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260908075029_csf_workbook_import_recovery_request.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const digest = createHash("md5")
    .update(migration.split("$$")[1])
    .digest("hex");
  assert.ok(current.includes(signature));
  assert.ok(current.includes("md5(p.prosrc)='" + digest + "'"));
  assert.ok(
    current.includes(
      "p.proargnames=ARRAY['p_organization_id','p_cohort_id','p_actor_user_id','p_request_id','p_expected_drive_file_id']",
    ),
  );
  assert.ok(
    current.includes("count(*)=1 AND bool_and(a.grantee='service_role'"),
  );
  assert.ok(!preceding.includes(signature));
});

test("application source review pins its body and keeps prior releases unchanged", () => {
  const current = acceptedCatalogQuery(source, versions);
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 463));
  const signature =
    "plugin_data.csf_prepare_application_source_review_periods(uuid,uuid,uuid,integer)";
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260908081328_csf_application_source_review_period.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const digest = createHash("md5")
    .update(migration.split("$function$")[1])
    .digest("hex");
  assert.ok(current.includes(signature));
  assert.ok(current.includes("md5(p.prosrc)='" + digest + "'"));
  assert.ok(
    current.includes(
      "p.proargnames=ARRAY['p_organization_id','p_actor_user_id','p_source_id','p_expected_mapping_version']",
    ),
  );
  assert.ok(!preceding.includes(signature));
});

test("legacy release catalogs stay unchanged", () => {
  assert.equal(acceptedCatalogQuery(source, versions.slice(0, 444)), source);
});

test("requirement evidence pins the append body and preserves the preceding catalog", () => {
  const current = acceptedCatalogQuery(source, versions);
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 461));
  const signature =
    "plugin_data.csf_append_import_preview_rows(uuid,uuid,uuid,jsonb)";
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260908020559_csf_requirement_source_evidence.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const body = migration.split("$function$")[1];
  const digest = createHash("md5").update(body).digest("hex");
  assert.ok(current.includes(signature));
  assert.ok(current.includes("md5(p.prosrc)='" + digest + "'"));
  assert.ok(!preceding.includes(signature));
  assert.ok(current.includes("p.proconfig=ARRAY['search_path=\"\"']"));
  assert.ok(
    current.includes(
      "p.proargnames=ARRAY['p_organization_id','p_actor_user_id','p_preview_job_id','p_rows']",
    ),
  );
  assert.ok(
    current.includes(
      "AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')",
    ),
  );
});

test("scheduling retirement pins every replacement and preserves the prior release catalog", () => {
  const current = acceptedCatalogQuery(source, versions);
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 460));
  for (const definition of [
    "('app_private.retire_csf_scheduled_posts()','6e08e34639831cc8d178d1363c91fa61',false)",
    "('plugin_data.csf_guard_announcement_schedule_lifecycle()','af351b0c18cd5a9fa1c333dd9502c58d',false)",
    "('plugin_data.csf_publish_due_posts(integer,text)','bd1c22ec097dab0f168b93ef6d5581a8',true)",
    "('plugin_data.csf_mutate_post(uuid,text,uuid,jsonb,uuid,uuid)','9dee34bed53f2c27f2b80b7ddafbfcbf',true)",
    "('app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)','91318f5b00c40c30b9be7a36a08c5109',false)",
  ]) {
    assert.ok(current.includes(definition), definition);
    assert.ok(!preceding.includes(definition), definition);
  }
  assert.match(current, /SELECT count\(\*\) = 14 AND/u);
  assert.match(preceding, /SELECT count\(\*\) = 10 AND/u);
  assert.ok(
    current.includes(
      "has_function_privilege('service_role',p.oid,'EXECUTE') = expected.service_execute",
    ),
  );
  assert.ok(
    current.includes("AND NOT has_function_privilege('anon',p.oid,'EXECUTE')"),
  );
  assert.ok(
    current.includes(
      "AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')",
    ),
  );
});

test("identity review upgrade checks exact body, bounded signature, and server-only permissions", () => {
  const query = acceptedCatalogQuery(source, versions);
  assert.match(query, /csf_class_import_review_rows\(uuid,uuid,integer\)/u);
  assert.match(query, /md5\(p.prosrc\)='97c62342820cbe42f25b6361725eb630'/u);
  assert.match(query, /AND NOT p.prosecdef/u);
  assert.match(query, /pg_get_expr\(p.proargdefaults,0\)='25'/u);
  assert.match(query, /'warnings','errors','review_reason'/u);
  assert.doesNotMatch(
    acceptedCatalogQuery(source, versions.slice(0, 451)),
    /csf_class_import_review_rows/u,
  );
});

test("officer annotation review checks the receipt index and refuses the legacy runtime entry point", () => {
  const query = acceptedCatalogQuery(source, versions);
  assert.match(
    query,
    /csf_review_import_annotation\(uuid,uuid,uuid,uuid,text,text\)/u,
  );
  assert.match(query, /md5\(p.prosrc\)='5a3d1acada42ee4fff0206684c4cfd77'/u);
  assert.match(query, /md5\(p.prosrc\)='a91a1e38692139da856c4e52e94db60c'/u);
  assert.match(
    acceptedCatalogQuery(source, versions.slice(0, 456)),
    /md5\(p.prosrc\)='984eecbf0c4068bd103d0548aa6adffa'/u,
  );
  assert.match(query, /md5\(p.prosrc\)='5bc80be3b2524a588bfa6ae920921a7f'/u);
  assert.match(
    acceptedCatalogQuery(source, versions.slice(0, 459)),
    /md5\(p.prosrc\)='1a753bdc4474fb1f5fcbb93f4d56d4d1'/u,
  );
  assert.match(
    acceptedCatalogQuery(source, versions.slice(0, 455)),
    /md5\(p.prosrc\)='edb9f2c1f2d5ef8f9759b4679328876b'/u,
  );
  assert.match(
    acceptedCatalogQuery(source, versions.slice(0, 454)),
    /md5\(p.prosrc\)='ddc531d82a237eae28a29bff3dacffd8'/u,
  );
  assert.match(query, /csf_officer_annotation_review_request_idx/u);
  assert.match(
    query,
    /csf_apply_import_annotation_interpretation\(uuid,uuid,text,text,uuid\)/u,
  );
  assert.doesNotMatch(
    acceptedCatalogQuery(source, versions.slice(0, 452)),
    /csf_review_import_annotation/u,
  );
});

test("compound-name search checks exact behavior, result fields, grants, and prefix indexes", () => {
  const query = acceptedCatalogQuery(source, versions);
  assert.match(query, /md5\(p.prosrc\)='b4ab6f2930a415f7d249e5c133e4d051'/u);
  assert.match(query, /p.proargnames=ARRAY\['p_organization_id'/u);
  assert.match(query, /csf_profiles_compact_full_name_prefix_idx/u);
  assert.match(query, /csf_profiles_compact_reverse_name_prefix_idx/u);
  assert.match(query, /op.opcname='text_pattern_ops'/u);
  assert.doesNotMatch(
    acceptedCatalogQuery(source, versions.slice(0, 449)),
    /csf_profiles_compact_full_name_prefix_idx/u,
  );
});

test("workbook rebuild release checks the exact body, server-only grants, and receipt index", () => {
  const query = acceptedCatalogQuery(source, versions);
  assert.match(
    query,
    /csf_request_class_workbook_reprepare\(uuid,uuid,uuid,uuid,text\)/u,
  );
  assert.match(query, /md5\(p.prosrc\)='a2ae5e479822c1cb54dd405810b6a909'/u);
  assert.match(
    acceptedCatalogQuery(source, versions.slice(0, 450)),
    /md5\(p.prosrc\)='978fc913e56af1893565d56706941f69'/u,
  );
  assert.match(query, /p.proconfig=ARRAY\['search_path=""'\]/u);
  assert.match(query, /count\(\*\)=1 AND bool_and\(a.grantee='service_role'/u);
  assert.match(query, /csf_workbook_reprepare_request_idx/u);
  assert.match(
    query,
    /i.indisunique AND i.indisvalid AND i.indisready AND i.indislive/u,
  );
  assert.doesNotMatch(
    acceptedCatalogQuery(source, versions.slice(0, 448)),
    /csf_request_class_workbook_reprepare/u,
  );
});

test("the reviewed import upgrade verifies metadata, function grants, and the scoped index", () => {
  const query = acceptedCatalogQuery(source, versions);
  assert.match(query, /SELECT count\(\*\) = 14 AND/u);
  assert.match(query, /csf_import_rows_resolution_metadata_object/u);
  assert.match(query, /a.atttypid='jsonb'::regtype AND a.attnotnull/u);
  assert.match(query, /csf_import_rows_committed_source_key_idx/u);
  assert.match(query, /i.indisvalid AND i.indisready AND i.indislive/u);
  assert.match(query, /5bc80be3b2524a588bfa6ae920921a7f/u);
  assert.match(
    acceptedCatalogQuery(source, versions.slice(0, 453)),
    /9d5b02f7b4cdb7c948aad0398ed29bdf/u,
  );
  assert.match(query, /641568ea97cc01fff75298d218a1404d/u);
  const old = acceptedCatalogQuery(source, versions.slice(0, 446));
  assert.match(old, /SELECT count\(\*\) = 8 AND/u);
  assert.doesNotMatch(old, /resolution_metadata/u);
  assert.throws(
    () => acceptedCatalogQuery(source, versions.slice(0, 447)),
    /explicit release review/u,
  );
});

test("point updates deny direct runtime writes while retaining the preceding catalog", () => {
  const clause =
    "has_any_column_privilege(roles.name, 'plugin_data.csf_point_submissions', 'UPDATE')";
  assert.ok(acceptedCatalogQuery(source, versions).includes(clause));
  assert.ok(
    !acceptedCatalogQuery(source, versions.slice(0, 458)).includes(clause),
  );
});

test("point verification pins the repaired trigger and keeps its execution internal", () => {
  const definition =
    "('plugin_data.csf_enforce_point_submission_freeze()','932eae452025dfd57e24d644b441aea4',false)";
  assert.ok(acceptedCatalogQuery(source, versions).includes(definition));
  const preceding = acceptedCatalogQuery(source, versions.slice(0, 457));
  assert.ok(!preceding.includes(definition));
  assert.match(preceding, /SELECT count\(\*\) = 9 AND/u);
});

test("point verification checks the installed trigger, not only its function", () => {
  const query = acceptedCatalogQuery(source, versions);
  const start = query.indexOf(
    "t.tgname = 'csf_point_submissions_verification_freeze'",
  );
  assert.ok(start >= 0);
  const posture = query.slice(start, query.indexOf(") AS valid", start));
  for (const clause of [
    "t.tgrelid = to_regclass('plugin_data.csf_point_submissions')",
    "t.tgfoid = to_regprocedure('plugin_data.csf_enforce_point_submission_freeze()')",
    "t.tgenabled = 'O'",
    "t.tgtype = 31",
    "NOT t.tgisinternal",
    "t.tgconstraint = 0",
    "t.tgqual IS NULL",
    "t.tgnargs = 0",
    "octet_length(t.tgargs) = 0",
    "t.tgattr::text = ''",
    "NOT t.tgdeferrable",
    "NOT t.tginitdeferred",
  ])
    assert.ok(posture.includes(clause), clause);
  assert.ok(
    !acceptedCatalogQuery(source, versions.slice(0, 457)).includes(
      "t.tgname = 'csf_point_submissions_verification_freeze'",
    ),
  );
});

test("checks old email-only fragments on the renamed helper, not the provenance wrapper", () => {
  const query = acceptedCatalogQuery(source, versions);
  const fragments = query.slice(
    query.indexOf("expected_function_fragments("),
    query.indexOf("function_fragment_posture AS"),
  );
  assert.equal(
    fragments.match(/csf_revalidate_class_code_connection_replay_legacy\(uuid/g)
      ?.length,
    2,
  );
  assert.ok(fragments.includes("'''connectionbasis'', ''verified_email'''"));
  assert.ok(fragments.includes("'''verifiedemailmatch'', true'"));
  assert.match(query, /md5\(pg_get_functiondef\(p.oid\)\) = expected.digest/u);
  assert.match(
    query,
    /WHEN \(SELECT valid FROM accepted_upgrade_posture\) AND/u,
  );
  assert.match(query, /csf_confirm_class_code_account_name_match_v4/u);
  assert.match(query, /NOT has_function_privilege\('authenticated'/u);
  assert.match(query, /set_csf_release_worker_control/u);
  assert.match(query, /csf_record_connection_basis_after_audit/u);
  assert.match(query, /t\.tgenabled = 'O'/u);
  assert.match(query, /t\.tgtype = 5/u);
  assert.match(query, /t\.tgfoid = to_regprocedure/u);
  assert.ok(query.includes("AND a.atttypid='text'::regtype AND a.attnotnull"));
  assert.ok(
    query.includes("pg_get_expr(d.adbin,d.adrelid) = '''unknown''::text'"),
  );
  assert.ok(query.includes("k.convalidated AND k.contype='c'"));
  assert.ok(query.includes("pg_get_constraintdef(k.oid) = $$CHECK"));
  assert.ok(query.includes("has_any_column_privilege"));
  assert.ok(query.includes("c.relpersistence = 'p'"));
  assert.ok(query.includes("a.attgenerated='' AND a.attidentity=''"));
  assert.ok(
    query.includes("OR a.is_grantable OR a.grantor <> 'postgres'::regrole"),
  );
  assert.ok(query.includes("FROM accepted_worker_relations"));
});

test("missing or repeated final gate anchors fail closed", () => {
  const anchor = "WHEN (SELECT valid FROM table_posture)";
  for (const modified of [
    source.replace(anchor, "WHEN\n(SELECT valid FROM table_posture)"),
    source + "\n-- " + anchor,
  ]) {
    assert.throws(
      () => acceptedCatalogQuery(modified, versions),
      /result contract/u,
    );
  }
});

test("unknown migration upgrades require review", () => {
  assert.throws(
    () => acceptedCatalogQuery(source, [...versions, "20260906000000"]),
    /explicit release review/u,
  );
});

test("a changed ledger cannot reuse the accepted maximum version", () => {
  for (const changed of [
    [...versions.slice(0, -1), "20260904020000", versions.at(-1)],
    versions.slice(1),
    ["20200101000000", ...versions.slice(1)],
    [versions[1], versions[0], ...versions.slice(2)],
    versions.filter((version) => version !== "20260904010000"),
    versions.slice(0, -2).slice(1),
  ]) {
    assert.throws(
      () => acceptedCatalogQuery(source, changed),
      /explicit release review/u,
    );
  }
});

test("changed source contract cannot silently remove a check", () => {
  assert.throws(
    () =>
      acceptedCatalogQuery(
        source.replace(
          "expected_function_fragments(signature",
          "changed(signature",
        ),
        versions,
      ),
    /fragment contract/u,
  );
  assert.throws(
    () =>
      acceptedCatalogQuery(
        source.replace("SELECT 1 / CASE", "SELECT 2 / CASE"),
        versions,
      ),
    /result contract/u,
  );
});
