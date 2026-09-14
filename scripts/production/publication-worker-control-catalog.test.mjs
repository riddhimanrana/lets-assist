import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("515 pins the v2 reader, owner-only setter and changed control relation", () => {
  assert.equal(versions.length, 517);
  const current = acceptedCatalogQuery(source, versions);
  for (const fragment of [
    "('public.read_csf_release_worker_controls_v2(text)','0205a3e8b6a9f00535fe63f88b2318d9',true)",
    "('app_private.set_csf_release_worker_control(text,text,boolean,bigint,uuid,text,text)','428c972f30cac132f0b93a74072fda41',false)",
    "('public.read_csf_release_worker_controls(text)','a3e5236a9ae2bc7d54ffcd600fab0798',true)",
    "WHEN 'csf_release_worker_controls' THEN 'efccf167accba776d136bae856a58a8f'",
    "WHEN 'csf_release_worker_receipts' THEN '94e9bc198f37156522b9aed76bf696a4'",
    "count(*)=2 AND bool_and(runtime_denied AND digest = CASE relname",
    "NOT has_function_privilege('anon',p.oid,'EXECUTE')",
    "NOT has_function_privilege('authenticated',p.oid,'EXECUTE')",
    "SELECT count(*) = 38 AND",
  ])
    assert.ok(current.includes(fragment), fragment);
  assert.ok(!current.includes("b186cfbfbb17fee4e0966cde6d3bec9e"));
  assert.ok(!current.includes("91318f5b00c40c30b9be7a36a08c5109"));
});

test("515 leaves the accepted 514 catalog byte-for-byte unchanged", () => {
  const previous = acceptedCatalogQuery(source, versions.slice(0, 514));
  assert.equal(
    createHash("sha256").update(previous).digest("hex"),
    "17a8fa557c784a68ca1725c4113e935eeab73ca59d24e0c86bb4b84859dc6a38",
  );
  assert.ok(!previous.includes("read_csf_release_worker_controls_v2"));
});

test("an altered 515 ledger cannot select the worker control catalog", () => {
  const altered = [...versions];
  altered[514] = "20260914044611";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});

test("516 signed publication preserves the exact accepted 515 schema", () => {
  assert.equal(
    acceptedCatalogQuery(source, versions.slice(0, 516)),
    acceptedCatalogQuery(source, versions.slice(0, 515)),
  );
  const altered = [...versions];
  altered[515] = "20260914062208";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});

test("517 signed publication preserves the exact accepted 516 schema", () => {
  assert.equal(
    acceptedCatalogQuery(source, versions),
    acceptedCatalogQuery(source, versions.slice(0, 516)),
  );
  const altered = [...versions];
  altered[516] = "20260914072730";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
});
