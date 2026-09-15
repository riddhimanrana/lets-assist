import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import {
  csfApplicationImportNoopDefinitions,
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
  assert.equal(versions.length, 523);
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
    "('csf_terms','187a2d5a6edd2503074c1591fd5d757d',false)",
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
  assert.equal(versions.length, 523);
  const previous = acceptedCatalogQuery(source, versions.slice(0, 522));
  assert.equal(
    createHash("sha256").update(previous).digest("hex"),
    "086ec6cea32101216fcaea3e70894cb030b6c028391e8bced596eeb00f2e26c0",
  );
  const current = acceptedCatalogQuery(source, versions);
  for (const [
    signature,
    digest,
    service,
  ] of csfApplicationImportNoopDefinitions)
    assert.ok(current.includes(`('${signature}','${digest}',${service})`));
  assert.ok(current.includes("SELECT count(*) = 57 AND"));
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
  const altered = [...versions];
  altered[522] = "20260914170001";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});
