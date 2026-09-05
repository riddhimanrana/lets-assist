import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";

const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const versions = ["20260904010000", "20260905003409"];

test("legacy release catalogs stay unchanged", () => {
  assert.equal(acceptedCatalogQuery(source, ["20260903050000"]), source);
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
});

test("unknown migration upgrades require review", () => {
  assert.throws(
    () => acceptedCatalogQuery(source, [...versions, "20260906000000"]),
    /explicit release review/u,
  );
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
