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

test("590 release pins every new migration and its measured schema", () => {
  assert.equal(ledger.length, 590);
  assert.equal(ledger.at(-1), "20260918100000");
  const current = acceptedCatalogQuery(source, ledger);
  const previous = acceptedCatalogQuery(source, ledger.slice(0, 589));
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
  assert.match(previous, /a7a0680643c8c8a4f25ba969a3ff7459/u);
  assert.doesNotMatch(current, /a7a0680643c8c8a4f25ba969a3ff7459/u);
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

test("590 release refuses a changed ledger and catalog predecessor", () => {
  const changed = [...ledger];
  changed[589] = "20990101000000";
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
