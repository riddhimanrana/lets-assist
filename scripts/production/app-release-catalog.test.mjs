import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

test("legacy release catalogs stay unchanged", () => {
  assert.equal(acceptedCatalogQuery(source, versions.slice(0, 444)), source);
});

test("workbook rebuild release checks the exact body, server-only grants, and receipt index", () => {
  const query = acceptedCatalogQuery(source, versions);
  assert.match(
    query,
    /csf_request_class_workbook_reprepare\(uuid,uuid,uuid,uuid,text\)/u,
  );
  assert.match(query, /md5\(p.prosrc\)='978fc913e56af1893565d56706941f69'/u);
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
  assert.match(query, /SELECT count\(\*\) = 10 AND/u);
  assert.match(query, /csf_import_rows_resolution_metadata_object/u);
  assert.match(query, /a.atttypid='jsonb'::regtype AND a.attnotnull/u);
  assert.match(query, /csf_import_rows_committed_source_key_idx/u);
  assert.match(query, /i.indisvalid AND i.indisready AND i.indislive/u);
  assert.match(query, /9d5b02f7b4cdb7c948aad0398ed29bdf/u);
  assert.match(query, /641568ea97cc01fff75298d218a1404d/u);
  const old = acceptedCatalogQuery(source, versions.slice(0, 446));
  assert.match(old, /SELECT count\(\*\) = 8 AND/u);
  assert.doesNotMatch(old, /resolution_metadata/u);
  assert.throws(
    () => acceptedCatalogQuery(source, versions.slice(0, 447)),
    /explicit release review/u,
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
