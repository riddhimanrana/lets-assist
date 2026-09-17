import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { expectedVersions } from "./app-release-checks.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";
import { migrationDigests } from "./migration-digests.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("./verify-csf-target-schema.sql", import.meta.url),
  "utf8",
);
const ledger = expectedVersions(cwd);

test("597 release pins every new migration and its measured schema", () => {
  assert.equal(ledger.length, 597);
  assert.equal(ledger.at(-1), "20260918170000");
  const current = acceptedCatalogQuery(source, ledger);
  const prior592 = acceptedCatalogQuery(source, ledger.slice(0, 592));
  const previous = acceptedCatalogQuery(source, ledger.slice(0, 590));
  const preceding = acceptedCatalogQuery(source, ledger.slice(0, 582));
  assert.match(current, /420a97da04211e530a3fe4bac9d10a46/u);
  assert.match(current, /5a2e7874ae626e96f5cda454a55ea748/u);
  assert.doesNotMatch(current, /57c41026b33ca412f0b73645d520b795/u);
  assert.doesNotMatch(current, /a3769fe20a17380a403737ac5511f7a1/u);
  for (const name of [
    "csf_application_decision_sync_sources",
    "csf_cohorts",
    "csf_meeting_attendance",
    "csf_retention_preview_profiles",
    "csf_retention_retired_cohorts",
    "csf_sheet_semester_ledger_writes",
    "csf_term_meetings",
  ])
    assert.ok(current.includes(`'${name}'`), name);
  assert.match(current, /csf_class_publication_email_candidates/u);
  assert.match(current, /csf_correct_attendance_source_timestamp/u);
  assert.match(current, /project_status_schedule_window/u);
  assert.match(previous, /0abd6c8cfe331766e22001d8744d5541/u);
  assert.doesNotMatch(current, /0abd6c8cfe331766e22001d8744d5541/u);
  assert.match(current, /4bab1cba993d8504681ff8eb869b6a05/u);
  assert.match(current, /a6bfc7c31331671e7c7c90c918bbeb03/u);
  assert.match(current, /09e04b85d2aab1ca62c0497c53a919d3/u);
  assert.doesNotMatch(current, /61b3229cfbf62af18b217ac5e3255e64/u);
  assert.doesNotMatch(current, /f5b74163ac45204dc9249017e4aadd9e/u);
  assert.doesNotMatch(current, /3b006244758b8eaee4535a5ea7d297a1/u);
  assert.match(current, /51a12d2ff4a3f2a44a297b136ed631fc/u);
  assert.match(current, /34cf3ce530ba6b9066b260d65f6d3f87/u);
  assert.match(prior592, /3e555109b43f9bee6d0b36dc2e0671fe/u);
  assert.doesNotMatch(current, /3e555109b43f9bee6d0b36dc2e0671fe/u);
  assert.match(current, /330c00eddb988e4d5d9d19bca0b61f9d/u);
  assert.match(
    current,
    /NOT EXISTS \(\s*SELECT 1\s*FROM plugin_data\.csf_class_join_codes AS code/u,
  );
  assert.match(current, /afebeb55895133dc30e7cde6e9b3bac3/u);
  assert.match(current, /Auto check-in signups/u);
  assert.match(preceding, /57c41026b33ca412f0b73645d520b795/u);
  for (let count = 583; count <= 587; count++)
    assert.equal(
      acceptedCatalogQuery(source, ledger.slice(0, count)),
      preceding,
    );
  for (const version of ledger.slice(582)) {
    const file = Object.keys(migrationDigests).find((name) =>
      name.startsWith(`${version}_`),
    );
    assert.ok(file, version);
    const bytes = readFileSync(
      new URL(`../../supabase/migrations/${file}`, import.meta.url),
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.equal(migrationDigests[file], digest, file);
    assert.deepEqual(
      approvedMigrations.find(([name]) => name === file.slice(0, -4)),
      [file.slice(0, -4), digest],
    );
  }
});

test("593 release refuses a changed ledger and catalog predecessor", () => {
  const changed = [...ledger];
  changed[592] = "20990101000000";
  assert.throws(
    () => acceptedCatalogQuery(source, changed),
    /explicit release review/u,
  );
  assert.throws(
    () =>
      acceptedCatalogQuery(
        source.replace("WHEN (SELECT valid FROM table_posture)", "WHEN true"),
        ledger,
      ),
    /accepted catalog|contract changed/u,
  );
});
