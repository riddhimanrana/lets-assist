import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { noticeLedgerDefinitions } from "./notice-ledger-catalog.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const versions = expectedVersions(cwd);
const at = (count) => acceptedCatalogQuery(source, versions.slice(0, count));

test("notice and semester ledger pins begin at their exact migrations", () => {
  assert.equal(versions.length, 613);
  const before = at(573);
  const notice = at(574);
  const ledger = at(575);
  const lifecycle = at(576);
  const reconciled = at(577);
  const claimIdentity = at(578);
  const recovered = at(579);
  const mergeSerialized = at(580);
  const authorityFenced = at(581);
  assert.match(before, /f494ecf0746444bbb55bf2605123ab2a/u);
  assert.doesNotMatch(notice, /f494ecf0746444bbb55bf2605123ab2a/u);
  assert.match(notice, /8f8b113fd372dfe7b94ab2c26ca8708e/u);
  assert.match(notice, /2dfb67ba511a005c8aa41331b883845d/u);
  assert.doesNotMatch(notice, /6d44d27f039ccd271c868e7aa72f6635/u);
  assert.match(ledger, /6d44d27f039ccd271c868e7aa72f6635/u);
  assert.match(ledger, /47ab6207ab62d8ab7970670627b47f59/u);
  assert.match(ledger, /48a500ad4960c56dffca1cf1a823d3ad/u);
  assert.match(lifecycle, /86ffad9d7360ad5b970528949b66454e/u);
  assert.doesNotMatch(lifecycle, /48a500ad4960c56dffca1cf1a823d3ad/u);
  assert.match(reconciled, /f43d2748697aefbe585cb17b7f12dcd8/u);
  assert.match(reconciled, /csf_workbook_link_unsettled_write/u);
  assert.doesNotMatch(reconciled, /d0d9a05b0c292c7ff0552bd891dd9d62/u);
  assert.doesNotMatch(reconciled, /eabcc76e3e61eea9bcd91a6487b10c20/u);
  assert.match(claimIdentity, /1f68ca7ff0fb2a7725413c79d3b01436/u);
  assert.match(claimIdentity, /csf_guard_workbook_link_unsettled_write/u);
  assert.doesNotMatch(claimIdentity, /c36579ace2984906abb4fc59dc469d50/u);
  assert.match(recovered, /5c99b2d7923d08d11466dc58e5524211/u);
  assert.match(recovered, /dd5cb6c71170301102123cd714157921/u);
  assert.match(
    recovered,
    /csf_sheet_semester_ledger_nonaborted_receipt_unique/u,
  );
  assert.doesNotMatch(recovered, /681310b4b440be1ed2fe8ff92baabbb9/u);
  assert.match(mergeSerialized, /1e4e11d23ea344399b5ec31195615abf/u);
  assert.match(
    mergeSerialized,
    /csf_lock_identity_mutation\(p_organization_id\)/u,
  );
  assert.doesNotMatch(mergeSerialized, /1f68ca7ff0fb2a7725413c79d3b01436/u);
  assert.match(authorityFenced, /csf_semester_write_destination_authority/u);
  assert.match(authorityFenced, /csf_membership_unsettled_semester_write/u);
  assert.match(authorityFenced, /bed09085445ef97e0a34f0bab63e3828/u);
  assert.doesNotMatch(authorityFenced, /5c99b2d7923d08d11466dc58e5524211/u);
  assert.match(authorityFenced, /AS csf_target_schema_verified;$/u);
  for (const [signature, hash] of noticeLedgerDefinitions) {
    assert.ok(lifecycle.includes(signature), signature);
    assert.ok(lifecycle.includes(hash), signature);
  }
});

test("new release catalog keeps exact ACL, relation and retention checks", () => {
  const query = at(576);
  assert.match(query, /expected.service_execute/u);
  assert.match(query, /a.is_grantable/u);
  assert.match(
    query,
    /child_column='profile_id' AND policy='delete_with_owner'/u,
  );
  assert.match(query, /actual.digest=expected.digest/u);
  for (const count of [574, 575, 576, 577, 578, 579, 580, 581]) {
    const changed = versions.slice(0, count);
    changed[count - 1] = "20991231000000";
    assert.throws(
      () => acceptedCatalogQuery(source, changed),
      /explicit release review/u,
    );
  }
});
