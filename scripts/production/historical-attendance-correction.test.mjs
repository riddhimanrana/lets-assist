import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Source checks for 20260917110000.
 *
 * Nothing here has been run against a database. These prove the restated
 * function differs from its predecessor by exactly the listed edits, that the
 * ACLs are the reviewed ones, and that the pgTAP file plans the number of
 * assertions it makes. The behavioural proof is that pgTAP and the
 * coordinator's replay.
 */

const NAME = "20260917110000_csf_historical_attendance_correction";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) =>
  readFileSync(new URL(path, new URL(root, import.meta.url)), "utf8");

const current = read(`supabase/migrations/${NAME}.sql`);
const previous = read(
  "supabase/migrations/20260716224500_dvhs_csf_manual_attendance_corrections.sql",
);
const wrapper = read(
  "supabase/migrations/20260812220000_csf_meeting_permission_followups.sql",
);
const pgtap = read(
  "supabase/tests/database/csf_historical_attendance_correction.test.sql",
);

// The release pin for this migration is deliberately not asserted here. Several
// lanes are open, the ledger length and the approved-migration tail both move as
// they land, and the coordinator owns the final catalog. Pinning it from this
// branch would only guarantee a stale number.

test("NULLIF is written as syntax, never as a qualified function", () => {
  // A replay found pg_catalog.nullif(text, unknown) does not exist. plpgsql
  // bodies are not parsed at CREATE, so the migration applied and then failed
  // at runtime, taking 15 existing assertions down with it.
  assert.equal(current.includes("pg_catalog.nullif"), false);
  assert.ok(current.includes("nullif(pg_catalog.btrim(p_reason), '')"));
});

test("every other qualified call names a real pg_catalog function", () => {
  const allowed = new Set([
    "btrim",
    "convert_to",
    "encode",
    "gen_random_uuid",
    "hashtextextended",
    "jsonb_build_object",
    "jsonb_object_keys",
    "jsonb_typeof",
    "now",
    "pg_advisory_xact_lock",
    "set_config",
    "sha256",
  ]);
  const used = new Set(
    [...current.matchAll(/pg_catalog\.([a-z_0-9]+)/gu)].map((m) => m[1]),
  );
  assert.deepEqual(
    [...used].filter((name) => !allowed.has(name)),
    [],
  );
});

test("the guarded behaviours the predecessor had all survive", () => {
  for (const clause of [
    "Attendance correction operation must be set or remove.",
    "Choose a valid attendance status.",
    "A manual attendance correction reason is required.",
    "A manual attendance correction actor is required.",
    "Meeting not found.",
    "CSF member not found.",
    "No attendance record exists for this member and meeting.",
    "Only a manual attendance correction can be removed.",
  ]) {
    assert.ok(previous.includes(clause), `predecessor lost ${clause}`);
    assert.ok(current.includes(clause), `restatement dropped ${clause}`);
  }
});

test("the row is still located on the canonical meeting key, never on a label", () => {
  assert.ok(current.includes("attendance.meeting_key = v_meeting.meeting_key"));
  assert.ok(current.includes("ON CONFLICT (profile_id, term_id, meeting_key)"));
});

test("provenance of the corrected row is preserved, not overwritten", () => {
  for (const key of [
    "'previousSource'",
    "'previousSourceRowId'",
    "CASE WHEN v_existing_found THEN v_existing.source_row_id ELSE NULL END",
  ]) {
    assert.ok(current.includes(key), `lost ${key}`);
  }
});

test("no timestamp, point value or meeting date is invented", () => {
  // The only clock read is the row's own updated_at, which the predecessor also
  // set. Nothing derives a meeting date, and attendance carries no points.
  assert.equal((current.match(/pg_catalog\.now\(\)/gu) ?? []).length, 1);
  assert.equal(current.includes("meeting_date"), false);
  assert.equal(/\bpoints\b/u.test(current), false);
});

test("the closed-semester escape is the reviewed one and is recorded", () => {
  assert.ok(
    current.includes("CSF_CLOSED_SEMESTER_ACKNOWLEDGEMENT_REQUIRED=true"),
  );
  assert.ok(
    current.includes(
      "pg_catalog.set_config(\n      'plugin_data.csf_closed_term_edit_attested', 'on', true\n    )",
    ),
  );
  // Acted on and written down. A receipt that only reflects the write cannot
  // show later that the officer was told what they were editing.
  assert.ok(current.includes("'closedSemesterAcknowledged', v_closed"));
  // It is never assumed. The flag is set only inside the closed branch.
  const closedBranch = current.slice(
    current.indexOf("IF v_closed THEN"),
    current.indexOf("SELECT attendance.*"),
  );
  assert.ok(closedBranch.includes("csf_closed_term_edit_attested"));
});

test("the replay is bound to the payload, not just to the request id", () => {
  for (const field of [
    "'meetingId', p_meeting_id",
    "'profileId', p_profile_id",
    "'operation', p_operation",
    "'reason', pg_catalog.btrim(p_reason)",
    "'sourceRef', v_source_ref",
  ]) {
    assert.ok(current.includes(field), `digest does not cover ${field}`);
  }
  assert.ok(
    current.includes(
      "'That request identifier is already bound to a different attendance correction.'",
    ),
  );
  // The actor is checked too, so one officer cannot replay another's request.
  assert.ok(
    current.includes(
      "v_receipt.actor_user_id IS DISTINCT FROM p_actor_user_id",
    ),
  );
});

test("a null request id keeps its old meaning", () => {
  // No replay key means no receipt lookup, exactly as before. Guarding the
  // lookup on a non-null id is what keeps every existing caller working.
  assert.ok(current.includes("IF p_correlation_id IS NOT NULL THEN"));
});

test("the replay index is partial and scoped to these two actions", () => {
  assert.ok(current.includes("CREATE UNIQUE INDEX IF NOT EXISTS"));
  assert.ok(current.includes("WHERE correlation_id IS NOT NULL"));
  assert.ok(current.includes("'meeting.attendance_manual_corrected'"));
  assert.ok(current.includes("'meeting.attendance_manual_removed'"));
});

test("source evidence is stored and never interpreted", () => {
  assert.ok(
    current.includes(
      "'Attendance correction source evidence must be a JSON object.'",
    ),
  );
  assert.ok(current.includes("'sourceRef', v_source_ref"));
  // The status written is the argument. Nothing reads the source ref to choose
  // one, which is the line between recording a decision and making one.
  assert.ok(current.includes("      p_status,\n      'manual',"));
});

test("notice suppression is transaction-local and only for a source reconciliation", () => {
  assert.ok(
    current.includes(
      "pg_catalog.set_config('app.csf_suppress_notices', 'on', true)",
    ),
  );
  const branch = current.slice(
    current.indexOf("IF v_source_ref IS NOT NULL THEN"),
    current.indexOf("-- The payload this request is bound to"),
  );
  assert.ok(branch.includes("app.csf_suppress_notices"));
  assert.ok(current.includes("'noticesSuppressed', v_source_ref IS NOT NULL"));
});

test("both entrypoints exist and the original delegates unchanged", () => {
  assert.ok(
    wrapper.includes("csf_correct_meeting_attendance_permission_base"),
    "the wrapper/base split is the shape being extended",
  );
  // The eight-argument entrypoint means the same thing it always did.
  assert.ok(
    current.includes(
      "p_reason, p_actor_user_id, p_correlation_id, false, NULL\n  );",
    ),
  );
  // Both wrappers recheck authority under the staff-access lock before writing,
  // so a revoked officer cannot be serialized past.
  assert.equal(
    (current.match(/csf_assert_meeting_permission_under_lock/gu) ?? []).length,
    2,
  );
});

test("the ACLs are the reviewed ones on every signature", () => {
  const tenArg =
    "uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb";
  assert.ok(
    current.includes(
      `REVOKE ALL ON FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(\n  ${tenArg}\n) FROM PUBLIC, anon, authenticated, service_role;`,
    ),
    "the base must be unreachable, including by service_role",
  );
  assert.ok(
    current.includes(
      `GRANT EXECUTE ON FUNCTION plugin_data.csf_correct_meeting_attendance(\n  ${tenArg}\n) TO service_role;`,
    ),
  );
  assert.ok(
    current.includes(
      `REVOKE ALL ON FUNCTION plugin_data.csf_correct_meeting_attendance(\n  ${tenArg}\n) FROM PUBLIC, anon, authenticated, service_role;`,
    ),
  );
});

test("the pgTAP file plans the number of assertions it makes", () => {
  const planned = Number(pgtap.match(/extensions\.plan\((\d+)\)/u)[1]);
  const asserted = (
    pgtap.match(
      /extensions\.(ok|is|isnt|lives_ok|throws_ok|has_function)\(/gu,
    ) ?? []
  ).length;
  assert.equal(planned, asserted);
});

test("the pgTAP file covers each behaviour this migration adds", () => {
  for (const clause of [
    "replaying the identical request succeeds instead of writing again",
    "reusing a request id for a different status is refused, not replayed",
    "a closed semester refuses a correction that does not acknowledge it",
    "an acknowledged closed semester can be corrected",
    "the source reference is stored on the attendance row as evidence",
    "the stored status is the one the officer passed, not one derived from the source",
    "the original entrypoint is unchanged and still refuses closed evidence",
  ]) {
    assert.ok(pgtap.includes(clause), `pgTAP does not cover: ${clause}`);
  }
});

test("no earlier migration was edited", () => {
  assert.ok(previous.includes("CREATE OR REPLACE FUNCTION"));
  assert.equal(previous.includes("p_acknowledge_closed_semester"), false);
  assert.equal(previous.includes("requestDigest"), false);
});

test("the base grant is stated for the owner role", () => {
  // AGENTS requires an explicit REVOKE and GRANT for every new or replaced SQL
  // function. The base is owner-internal, so postgres is its reviewed role and
  // the grant says so rather than relying on a default.
  const tenArg =
    "uuid, uuid, uuid, text, text, text, uuid, uuid, boolean, jsonb";
  assert.ok(
    current.includes(
      `GRANT EXECUTE ON FUNCTION plugin_data.csf_correct_meeting_attendance_permission_base(\n  ${tenArg}\n) TO postgres;`,
    ),
  );
});

test("same-request callers serialize before the receipt lookup", () => {
  // Two retries arriving together would both miss the receipt, both proceed,
  // and the second would block on the unique index and fail rather than replay.
  // The lock has to be taken before the lookup for the loser to see the winner's
  // receipt.
  const guard = current.indexOf("IF p_correlation_id IS NOT NULL THEN");
  const lock = current.indexOf("pg_advisory_xact_lock");
  const lookup = current.indexOf("SELECT audit.* INTO v_receipt");
  assert.ok(guard >= 0 && lock >= 0 && lookup >= 0);
  assert.ok(guard < lock, "the lock is only taken when there is a replay key");
  assert.ok(lock < lookup, "the lock must precede the receipt lookup");
  // Scoped to the organization and the request, not to the table.
  assert.ok(
    current.includes(
      "p_organization_id::text || ':' || p_correlation_id::text",
    ),
  );
});

test("source evidence is scoped to officer coordinates", () => {
  assert.ok(
    current.includes(
      "'Attendance correction source evidence must name its sourceId.'",
    ),
  );
  assert.ok(
    current.includes(
      "ARRAY['sourceId', 'tabName', 'sheetId', 'sheetRow', 'columnNumber']",
    ),
  );
  // No free-text key. A note beside a decision gets read as the reason for it.
  for (const smuggled of ["'note'", "'comment'", "'reason'"]) {
    assert.equal(
      current.includes(
        `ARRAY['sourceId', 'tabName', 'sheetId', 'sheetRow', 'columnNumber', ${smuggled}]`,
      ),
      false,
    );
  }
});

test("the header does not claim the historical semesters are closed", () => {
  const header = current.slice(0, current.indexOf("BEGIN;"));
  assert.equal(
    header.includes("Every historical semester is therefore"),
    false,
  );
  assert.ok(header.includes("all open"));
});

test("the notice marker sits on after_data itself, not only in the receipt", () => {
  // An isolated replay found after_data->>'noticesSuppressed' NULL: the marker
  // was written inside `result` only, so the two assertions reading it at the
  // top level got nothing. Whether the member was told is a fact about the
  // correction and belongs beside the acknowledgement.
  const audit = current.slice(
    current.indexOf("coalesce(v_after,"),
    current.indexOf("'result', pg_catalog.jsonb_build_object("),
  );
  assert.ok(audit.includes("'closedSemesterAcknowledged', v_closed"));
  assert.ok(audit.includes("'noticesSuppressed', v_source_ref IS NOT NULL"));
  // Three places now: after_data, the replay receipt, and the return value.
  assert.equal(
    (current.match(/'noticesSuppressed', v_source_ref IS NOT NULL/gu) ?? [])
      .length,
    3,
  );
});
