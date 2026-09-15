import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import {
  csfApplicationImportNoopDefinitions,
  csfMixedCategoryResubmissionDefinitions,
  csfOneTwoFortySixDefinitions,
} from "./csf-1-2-46-catalog.mjs";

const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const versions = expectedVersions(
  fileURLToPath(new URL("../../", import.meta.url)),
);

test("522 pins every changed function body and execution ACL", () => {
  assert.equal(versions.length, 529);
  const current = acceptedCatalogQuery(source, versions.slice(0, 522));
  assert.equal(csfOneTwoFortySixDefinitions.length, 20);
  for (const [signature, digest, service] of csfOneTwoFortySixDefinitions)
    assert.ok(current.includes(`('${signature}','${digest}',${service})`));
  assert.ok(current.includes("SELECT count(*) = 56 AND"));
});

test("522 pins the exact six changed relation shapes", () => {
  const current = acceptedCatalogQuery(source, versions.slice(0, 522));
  for (const fragment of [
    "('csf_opportunities','9b1b4a82e52bf0b006bb4962fb64554d',false)",
    "('csf_point_submissions','9c89b53001230c25776267a5990e1175',false)",
    "('csf_admin_audit_events','d1dc57a4ba8b99f76f7f004ce6ba5bbf',false)",
    "('csf_terms','7d5a926c181e90f73751bbc49ace1109',false)",
    "('csf_term_applications','9be38d4860e44a5696c75358d3707efc',false)",
    "('csf_publication_notification_deliveries','9615c8ab9d7f7ce4edc4c4bec52811e3',true)",
  ])
    assert.ok(current.includes(fragment), fragment);
  assert.ok(current.includes("FULL JOIN"));
});

test("522 preserves the accepted 518 catalog byte for byte", () => {
  assert.equal(
    createHash("sha256")
      .update(acceptedCatalogQuery(source, versions.slice(0, 518)))
      .digest("hex"),
    "3db331f3bf836da83e5c26652444b166bb74bdb5dbc4fb54acc6b83629d37831",
  );
});

test("523 adds only the reviewed import no-op function definition", () => {
  assert.equal(versions.length, 529);
  const previous = acceptedCatalogQuery(source, versions.slice(0, 522));
  assert.equal(
    createHash("sha256").update(previous).digest("hex"),
    "9d0831344edda82e9a7639b07f0257b1261f4a036c08ba1b5389368bfba76752",
  );
  const current = acceptedCatalogQuery(source, versions.slice(0, 523));
  for (const [
    signature,
    digest,
    service,
  ] of csfApplicationImportNoopDefinitions)
    assert.ok(current.includes(`('${signature}','${digest}',${service})`));
  assert.ok(current.includes("SELECT count(*) = 57 AND"));
});

test("524 adds only the mixed-category resubmission definition", () => {
  const current = acceptedCatalogQuery(source, versions.slice(0, 524));
  for (const [
    signature,
    digest,
    service,
  ] of csfMixedCategoryResubmissionDefinitions)
    assert.ok(current.includes(`('${signature}','${digest}',${service})`));
  assert.ok(current.includes("SELECT count(*) = 58 AND"));
});

test("an altered 522 ledger cannot select the candidate catalog", () => {
  const altered = versions.slice(0, 522);
  altered[521] = "20260914160001";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});

test("an altered 523 ledger cannot select the candidate catalog", () => {
  const altered = versions.slice(0, 523);
  altered[522] = "20260914170001";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});

test("an altered 524 ledger cannot select the candidate catalog", () => {
  const altered = versions.slice(0, 524);
  altered[523] = "20260915015214";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});

test("525 publishes 1.2.46 without changing the accepted function catalog", () => {
  const previous = acceptedCatalogQuery(source, versions.slice(0, 524));
  const current = acceptedCatalogQuery(source, versions.slice(0, 525));
  assert.equal(current, previous);
});

test("an altered 525 ledger cannot select the candidate catalog", () => {
  const altered = versions.slice(0, 525);
  altered[524] = "20260915032758";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});

test("526 selects corrected point and intake definitions", () => {
  const query = acceptedCatalogQuery(source, versions.slice(0, 526));
  assert.ok(query.includes("25933deb284ee95856ef2f6cb187973f"));
  assert.ok(query.includes("85998c4bd13e82c3349c4055a5488814"));
  assert.ok(!query.includes("2213eb3174097e1a28ec49552380ab64"));
  const altered = versions.slice(0, 526);
  altered[525] = "20260915050001";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});

test("527 checks current and open term on native inserts", () => {
  const query = acceptedCatalogQuery(source, versions.slice(0, 527));
  assert.ok(query.includes("384b099495c0b987bc1bee3ebcf61c24"));
  assert.ok(!query.includes("32b6748383385c7e4d38885da5851f8e"));
  const altered = versions.slice(0, 527);
  altered[526] = "20260915051001";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});

test("528 publishes 1.2.47 without changing the accepted function catalog", () => {
  const previous = acceptedCatalogQuery(source, versions.slice(0, 527));
  const current = acceptedCatalogQuery(source, versions.slice(0, 528));
  assert.equal(current, previous);
});

test("an altered 528 ledger cannot select the candidate catalog", () => {
  const altered = [...versions];
  altered[527] = "20260915051714";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});

test("529 pins fixed-submission uniqueness without changing earlier catalogs", () => {
  const previous = acceptedCatalogQuery(source, versions.slice(0, 528));
  const current = acceptedCatalogQuery(source, versions);
  assert.ok(previous.includes("9c89b53001230c25776267a5990e1175"));
  assert.ok(current.includes("db32b25e5818c2067614aebe169f4cb9"));
  assert.equal(
    current.replaceAll(
      "db32b25e5818c2067614aebe169f4cb9",
      "9c89b53001230c25776267a5990e1175",
    ),
    previous,
  );
  const altered = [...versions];
  altered[528] = "20260915054937";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});
