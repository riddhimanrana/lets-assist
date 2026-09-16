import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acceptedCatalogQuery,
  acceptedFingerprints561,
} from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import {
  approvedMigrations,
  prepareMigration,
} from "./forward-migration-release.mjs";

// The 561 extension set is prepared here but not yet pinnable. These checks
// hold the two open blockers still so neither is lost, and they keep working
// unchanged once the blockers clear.

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const ledger = expectedVersions(cwd);
const EXTENSIONS = [
  "20260917070000_csf_class_join_review_only_onboarding",
  "20260917080000_csf_detailed_publication_notices",
  "20260917090000_csf_officer_application_editor_and_note_visibility",
  "20260917110000_csf_historical_attendance_correction",
];

test("the release is the 557 decisions baseline plus the four integrated extensions", () => {
  assert.equal(ledger.length, 561);
  assert.deepEqual(
    ledger.slice(-4),
    EXTENSIONS.map((name) => name.slice(0, 14)),
  );
  // 1000 retention audited but was not accepted, so it must not appear.
  assert.ok(!ledger.includes("20260917100000"));
  for (const name of EXTENSIONS) {
    assert.ok(
      approvedMigrations.some(([entry]) => entry === name),
      `${name} is not in the approved migration tail`,
    );
  }
});

test("each fingerprint the extensions move is measured, or named as unmeasured", () => {
  const baseline = acceptedCatalogQuery(source, ledger.slice(0, 557));
  for (const entry of acceptedFingerprints561) {
    assert.equal(
      baseline.split(entry.before).length - 1,
      entry.occurrences,
      `${entry.object}: the 557 catalog does not pin it ${entry.occurrences} time(s)`,
    );
    if (entry.after)
      assert.ok(
        !baseline.includes(entry.after),
        `${entry.object}: the replacement predates its migration`,
      );
  }

  // Both of these moved on a replayed database. Neither was reported, and
  // neither can be derived from the migration text: one is
  // md5(pg_get_functiondef(oid)), the other the relation digest the catalog
  // builds from columns, constraints, indexes and triggers.
  assert.deepEqual(
    acceptedFingerprints561
      .filter((entry) => !entry.after)
      .map((e) => e.object),
    [
      "plugin_data.csf_record_publication_notifications()",
      "plugin_data.csf_publication_events (relation)",
    ],
  );
});

test("the 561 catalog refuses to pin what was never measured", () => {
  const unmeasured = acceptedFingerprints561.filter((entry) => !entry.after);
  if (unmeasured.length) {
    assert.throws(
      () => acceptedCatalogQuery(source, ledger),
      /moved but were never measured/u,
      "an unmeasured drift must fail closed, not delegate",
    );
    return;
  }
  // Once every value is supplied the swap has to be complete and exact.
  const current = acceptedCatalogQuery(source, ledger);
  const baseline = acceptedCatalogQuery(source, ledger.slice(0, 557));
  for (const entry of acceptedFingerprints561) {
    assert.ok(!current.includes(entry.before), `${entry.object} survived`);
    assert.equal(
      current.split(entry.after).length - 1,
      entry.occurrences,
      `${entry.object} was not swapped everywhere`,
    );
  }
  assert.equal(current.length, baseline.length);
});

test("a ledger the catalog has never reviewed still fails closed", () => {
  const altered = [...ledger];
  altered[558] = "20990101000000";
  assert.throws(
    () => acceptedCatalogQuery(source, altered),
    /explicit release review/u,
  );
  assert.throws(
    () => acceptedCatalogQuery(source, ledger.slice(0, 560)),
    /explicit release review/u,
  );
});

test("only 0900 writes data outside a function body, and the control still refuses it", () => {
  // The forward-migration controller forbids data writes in the SQL it sends.
  // 0900 backfills edit_application_records onto roles that already decide
  // applications. That is a real data change, not a schema change, and the
  // control below is what stops it shipping through this path.
  const offenders = [];
  for (const name of EXTENSIONS) {
    const sql = readFileSync(
      `${cwd}supabase/migrations/${name}.sql`,
      "utf8",
    ).replace(/\$\$[\s\S]*?\$\$/gu, "");
    for (const write of sql.matchAll(
      /(?:INSERT INTO|UPDATE|DELETE FROM) (?:public\.organization_plugin_installs|plugin_data\.)\w*/gu,
    ))
      offenders.push([name, write[0]]);
  }
  assert.deepEqual(offenders, [
    [
      "20260917090000_csf_officer_application_editor_and_note_visibility",
      "INSERT INTO plugin_data.csf_role_permissions",
    ],
  ]);

  // Stated as a fact about the shipped tail, so nobody has to rediscover why
  // the two applied-ledger controls in forward-migration-release.test.mjs are
  // red. They are correct; the migration is what has to change.
  const prepared = prepareMigration(cwd, readFileSync, ledger.slice(0, 512));
  assert.match(
    prepared.query.replace(/\$\$[\s\S]*?\$\$/gu, ""),
    /INSERT INTO plugin_data\.csf_role_permissions/u,
  );
});
