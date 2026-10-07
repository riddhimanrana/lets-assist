import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { expectedVersions } from "./app-release-checks.mjs";
import { acceptedCatalogQuery } from "./app-release-catalog.mjs";
import { csfSubmissionDeletionCatalog } from "./csf-submission-deletion-catalog.mjs";
import { finalSchemaCatalog, ledgerDigest } from "./final-schema-manifest.mjs";
import { assertCleanInventory } from "./generate-final-schema-manifest.mjs";
import { approvedMigrations } from "./forward-migration-release.mjs";

const repository = resolve(import.meta.dirname, "../..");
const candidateLedger = expectedVersions(repository);
// Retain the old derived catalog as historical evidence. The repaired forward
// drafts need a new replay and catalog before the release controller accepts them.
const ledger = candidateLedger.map((version) =>
  version.startsWith("2026100901000")
    ? version.replace("2026100901000", "2026092912000")
    : version,
);
const readManifest = (count) =>
  JSON.parse(
    readFileSync(
      new URL(`./final-schema-${count}.json`, import.meta.url),
      "utf8",
    ),
  );
// The attendance delta was reviewed on a fresh 638 -> 642 replay. It was then
// renumbered after Development's 683-entry ledger. 687 applies that delta to
// the 683 inventory, so the objects each side changes must stay disjoint.
const reviewedBase = readManifest(638);
const before = readManifest(683);
const after = readManifest(687);
const attendanceVersions = [
  "20260929120000",
  "20260929120001",
  "20260929120002",
  "20260929120003",
];
const baselineLedger = ledger.filter(
  (version) => !attendanceVersions.includes(version),
);
const previous = new Map(
  before.objects.map((row) => [row.identity, row.digest]),
);
const added = after.objects.filter((row) => !previous.has(row.identity));
const changed = after.objects.filter(
  (row) =>
    previous.has(row.identity) && previous.get(row.identity) !== row.digest,
);

const EXPECTED_ADDED = [
  "function:private.assert_attendance_not_future(p_intervals jsonb)",
  "function:private.assert_attendance_session_ended(p_project_id uuid, p_schedule_id text)",
  "function:private.assert_no_unlinked_platform_award(p_signup_id uuid)",
  "function:private.attendance_interval_minutes(p_intervals jsonb)",
  "function:private.guard_reviewed_attendance_envelope()",
  "function:private.lock_attendance_management(p_project_id uuid, p_actor_id uuid)",
  "function:private.normalize_attendance_intervals(p_intervals jsonb)",
  "function:private.protect_corrected_certificate_snapshot()",
  "function:private.protect_legacy_platform_award()",
  "function:private.set_project_attendance_intervals(p_signup_id uuid, p_intervals jsonb, p_exception_reason text)",
  "function:private.signup_attendance_intervals(p_signup_id uuid)",
  "function:private.stamp_certificate_attendance()",
  "function:public.add_paper_attendance_row(p_project_id uuid, p_batch_id uuid, p_actor_id uuid, p_request_id uuid)",
  "function:public.combine_paper_attendance_rows(p_project_id uuid, p_batch_id uuid, p_actor_id uuid, p_target_row_id uuid, p_source_row_ids uuid[], p_request_id uuid)",
  "function:public.correct_project_attendance(p_signup_id uuid, p_expected_revision integer, p_reason text, p_intervals jsonb, p_request_id uuid, p_actor_id uuid)",
  "function:public.create_attendance_print_sheet(p_project_id uuid, p_schedule_id text, p_actor_id uuid, p_blank_rows integer, p_continuation_rows integer)",
  "function:public.create_attendance_print_sheets(p_project_id uuid, p_schedule_ids text[], p_actor_id uuid, p_blank_rows integer, p_continuation_rows integer, p_request_id uuid)",
  "function:public.create_manual_attendance_batch(p_project_id uuid, p_schedule_id text, p_actor_id uuid, p_request_id uuid)",
  "function:public.link_guest_attendance_account(p_anonymous_id uuid, p_user_id uuid, p_token text)",
  "function:public.project_corrected_certificate_ids(p_project_id uuid, p_actor_id uuid)",
  "function:public.record_project_attendance(p_signup_id uuid, p_expected_revision integer, p_reason text, p_intervals jsonb, p_request_id uuid, p_actor_id uuid)",
  "function:public.request_corrected_certificate_delivery(p_project_id uuid, p_certificate_id uuid, p_expected_revision integer, p_request_id uuid, p_actor_id uuid)",
  "relation:private.anonymous_account_links",
  "relation:private.attendance_print_requests",
  "relation:private.corrected_certificate_delivery_requests",
  "relation:private.paper_attendance_commit_receipts",
  "relation:private.paper_attendance_review_operations",
  "relation:private.project_attendance_changes",
  "relation:public.project_attendance_intervals",
  "relation:public.project_attendance_print_rows",
  "relation:public.project_attendance_print_sheets",
];
const EXPECTED_CHANGED = [
  "function:app_private.guard_hours_publication_completeness()",
  "function:app_private.issue_verified_certificate_for_late_attendance()",
  "function:private.hours_publication_result(p_receipt_id uuid, p_outcome text)",
  "function:private.publish_volunteer_hours_transactional_legacy_status_fallback(p_actor_id uuid, p_project_id uuid, p_schedule_id text, p_entries jsonb, p_request_key text)",
  "function:public.commit_paper_signup_batch(p_batch_id uuid, p_actor_id uuid, p_row_ids uuid[], p_allow_over_capacity boolean, p_idempotency_key uuid)",
  "function:public.discard_paper_scan_batch(p_batch_id uuid, p_project_id uuid, p_actor_id uuid)",
  "function:public.issue_supplemental_verified_certificates(p_project_id uuid, p_schedule_id text, p_signup_ids uuid[], p_actor_id uuid)",
  "function:public.prepare_hours_publication_email_delivery(p_delivery_id uuid, p_sender text, p_subject text, p_html text)",
  "function:public.purge_expired_paper_scan_batches(p_limit integer)",
  "function:public.update_paper_scan_review_row(p_batch_id uuid, p_project_id uuid, p_row_id uuid, p_actor_id uuid, p_patch jsonb)",
  "relation:public.certificate_verification_read_model",
  "relation:public.certificates",
  "relation:public.hours_publication_email_outbox",
  "relation:public.project_paper_roster_entries",
  "relation:public.project_paper_scan_batches",
  "relation:public.project_paper_scan_rows",
  "relation:public.project_signups",
  "relation:public.user_certificate_read_model",
];

test("the repaired forward attendance ledger requires new catalog acceptance", () => {
  assert.deepEqual(candidateLedger.slice(-4), [
    "20261009010000",
    "20261009010001",
    "20261009010002",
    "20261009010003",
  ]);
  assert.throws(
    () => acceptedCatalogQuery("", candidateLedger),
    /explicit release review/u,
  );
  assert.throws(
    () => finalSchemaCatalog(after, candidateLedger),
    /reviewed ledger/u,
  );
});

test("the historical 687 catalog selects only its recorded ledger", () => {
  assert.equal(ledger.length, 687);
  assert.equal(
    ledgerDigest(ledger),
    "08211404c85b848f262937e27fc807c145677bd9f5d7b009fcfa0f4650f0ebd9",
  );
  assert.equal(
    acceptedCatalogQuery("invalid predecessor SQL", ledger),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(after, ledger)),
  );
  assert.equal(after.inventory, before.inventory);
  assert.doesNotThrow(() => assertCleanInventory(after.objects));
});

test("the frozen 683 baseline remains separate from attendance Production approval", () => {
  assert.equal(baselineLedger.length, 683);
  assert.deepEqual(ledger.slice(0, 683), baselineLedger);
  assert.deepEqual(ledger.slice(683), attendanceVersions);
  assert.equal(baselineLedger.at(-1), "20260929031000");
  assert.ok(
    attendanceVersions.every((version) => version > baselineLedger.at(-1)),
  );
  assert.equal(ledgerDigest(baselineLedger), before.ledger);
  assert.equal(
    acceptedCatalogQuery("", baselineLedger),
    csfSubmissionDeletionCatalog(finalSchemaCatalog(before, baselineLedger)),
  );
  for (const version of attendanceVersions) {
    assert.ok(
      !approvedMigrations.some(([name]) => name.startsWith(`${version}_`)),
    );
  }
});

test("the attendance catalog refuses altered, reordered, and extended ledgers", () => {
  for (const changed of [
    [...ledger.slice(0, -1), "20990101000000"],
    [...ledger, "20990101000000"],
    [...ledger].reverse(),
    ledger.slice(0, -1),
    [...ledger.slice(0, 678), ...attendanceVersions],
    [
      ...ledger.slice(0, 638),
      "20260921023000",
      "20260921023001",
      "20260921023002",
      "20260921023003",
    ],
    [
      ...ledger.slice(0, 683),
      "20260921023000",
      "20260921023001",
      "20260921023002",
      "20260921023003",
    ],
  ]) {
    assert.throws(
      () => acceptedCatalogQuery("", changed),
      /explicit release review/u,
    );
  }
  assert.throws(
    () => finalSchemaCatalog(after, baselineLedger),
    /reviewed ledger/u,
  );
});

test("manifest tampering cannot bypass inventory contract and identity checks", () => {
  for (const manifest of [
    { ...after, inventory: "0".repeat(64) },
    { ...after, ledger: before.ledger },
    { ...after, objects: [...after.objects, after.objects[0]] },
    {
      ...after,
      objects: [
        { ...after.objects[0], digest: "invalid" },
        ...after.objects.slice(1),
      ],
    },
  ]) {
    assert.throws(
      () => finalSchemaCatalog(manifest, ledger),
      /reviewed ledger or inventory contract/u,
    );
  }
  const query = acceptedCatalogQuery("", ledger);
  assert.match(query, /actual FULL JOIN expected USING\(identity\)/u);
  assert.match(query, /actual.digest IS DISTINCT FROM expected.digest/u);
});

test("the clean inventory adds only attendance-owned functions and relations", () => {
  assert.deepEqual(
    added.map((row) => row.identity),
    EXPECTED_ADDED,
  );
  const next = new Set(after.objects.map((row) => row.identity));
  assert.deepEqual(
    before.objects.filter((row) => !next.has(row.identity)),
    [],
  );
});

test("existing definitions and permissions change only for attendance objects", () => {
  assert.deepEqual(
    changed.map((row) => row.identity),
    EXPECTED_CHANGED,
  );
  for (const row of [...added, ...changed])
    assert.ok(!row.identity.includes(":plugin_data."));
});

test("the renumbered attendance delta is disjoint from Development's 638 to 683 changes", () => {
  const base = new Map(
    reviewedBase.objects.map((row) => [row.identity, row.digest]),
  );
  const developmentChanged = before.objects
    .filter((row) => base.get(row.identity) !== row.digest)
    .map((row) => row.identity);
  const attendance = new Set([...added, ...changed].map((row) => row.identity));
  assert.deepEqual(
    developmentChanged.filter((identity) => attendance.has(identity)),
    [],
  );
  assert.deepEqual(
    reviewedBase.objects.filter((row) => !previous.has(row.identity)),
    [],
  );
  assert.equal(before.inventory, reviewedBase.inventory);
});
