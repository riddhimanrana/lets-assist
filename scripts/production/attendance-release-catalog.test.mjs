import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { finalSchemaCatalog } from "./final-schema-manifest.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";
import { migrationDigests } from "./migration-digests.mjs";

const root = new URL("../../", import.meta.url).pathname;
const auditedLedger = expectedVersions(root).filter(
  (version) => version <= "20261008040000",
);
const publishedLedger = auditedLedger.slice(0, 687);
const attendanceDrafts = [
  "20261009010000_reviewed_attendance_intervals",
  "20261009010001_attendance_print_manifests",
  "20261009010002_corrected_certificate_delivery",
  "20261009010003_atomic_guest_account_link",
];
const attendanceVersions = attendanceDrafts.map((name) => name.slice(0, 14));
// This provisional union checks refusal before the drafts join the checkout.
// It is not a database replay or approval of their SQL bytes.
const combinedLedger = [...auditedLedger, ...attendanceVersions];
const publishedSource = readFileSync(
  new URL("./final-schema-687.json", import.meta.url),
  "utf8",
);
const publishedManifest = JSON.parse(publishedSource);
const auditManifest = JSON.parse(
  readFileSync(new URL("./final-schema-708.json", import.meta.url), "utf8"),
);

test("687 retains the published catalog instead of the paper branch's derived catalog", () => {
  assert.equal(publishedLedger.length, 687);
  assert.equal(publishedLedger.at(-1), "20260929051500");
  assert.equal(
    createHash("sha256").update(publishedSource).digest("hex"),
    "2456242a5144ba80cf5d3302de06aac5becfff469d147a4b9e0418132b3a1e60",
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", publishedLedger),
    csfSubmissionDeletionCatalog(
      finalSchemaCatalog(publishedManifest, publishedLedger),
    ),
  );
});

test("the provisional 712 ledger preserves the audit prefix and all four forward drafts", () => {
  assert.equal(auditedLedger.length, 708);
  assert.equal(auditedLedger.at(-1), "20261008040000");
  assert.equal(combinedLedger.length, 712);
  assert.equal(new Set(combinedLedger).size, combinedLedger.length);
  assert.deepEqual(combinedLedger.slice(0, 708), auditedLedger);
  assert.deepEqual(combinedLedger.slice(708), attendanceVersions);
  assert.deepEqual([...combinedLedger].sort(), combinedLedger);
});

test("every partial or complete attendance suffix requires explicit catalog review", () => {
  for (let count = 1; count <= attendanceVersions.length; count++) {
    assert.throws(
      () =>
        acceptedCatalogQuery("", [
          ...auditedLedger,
          ...attendanceVersions.slice(0, count),
        ]),
      /explicit release review/u,
    );
  }
  for (const manifest of [publishedManifest, auditManifest]) {
    assert.throws(
      () => finalSchemaCatalog(manifest, combinedLedger),
      /reviewed ledger/u,
    );
  }
});

test("the former paper 683 plus four ledger cannot reuse the published 687 identity", () => {
  const formerPaperLedger = [
    ...auditedLedger.slice(0, 683),
    "20260929120000",
    "20260929120001",
    "20260929120002",
    "20260929120003",
  ];
  assert.equal(formerPaperLedger.length, publishedLedger.length);
  assert.throws(
    () => acceptedCatalogQuery("", formerPaperLedger),
    /explicit release review/u,
  );
  assert.throws(
    () => finalSchemaCatalog(publishedManifest, formerPaperLedger),
    /reviewed ledger/u,
  );
});

test("attendance drafts do not inherit approval from historical migration counts", () => {
  for (const name of attendanceDrafts) {
    assert.ok(
      !approvedMigrations.some(([approved]) => approved === name),
      name,
    );
    assert.ok(!Object.hasOwn(migrationDigests, `${name}.sql`), name);
  }
});
