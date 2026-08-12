import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const migration = readFileSync(
  join(
    repositoryRoot,
    "supabase/migrations/20260812030000_csf_import_identity_lock_order.sql",
  ),
  "utf8",
);
const raceTest = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/csf_import_identity_merge_races.test.sql",
  ),
  "utf8",
);

const IMPORT_IDENTITY_BOUNDARIES = [
  "csf_claim_import_commit_attempt",
  "csf_commit_import_row_for_attempt",
  "csf_reconcile_sheet_import_row",
  "csf_commit_meeting_attendance_import",
  "csf_commit_partner_audit_import",
  "csf_import_class_history_row",
  "csf_import_class_history_row_v2",
  "csf_import_student_roster_row",
  "csf_import_application_response_row",
] as const;

function functionBody(name: string) {
  const start = migration.lastIndexOf(
    `CREATE OR REPLACE FUNCTION plugin_data.${name}(`,
  );
  expect(start, `${name} must be replaced by the forward migration`).toBeGreaterThan(
    -1,
  );
  const end = migration.indexOf("\n$$;", start);
  expect(end, `${name} must have a complete body`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("CSF import identity lock hierarchy", () => {
  test("inventories every profile-affecting import claim, writer, and commit", () => {
    for (const name of IMPORT_IDENTITY_BOUNDARIES) {
      expect(functionBody(name)).toContain(
        "plugin_data.csf_lock_identity_mutation(p_organization_id)",
      );
    }
  });

  test("the organization identity lock precedes authorization and every later lock", () => {
    for (const name of IMPORT_IDENTITY_BOUNDARIES) {
      const body = functionBody(name);
      const identity = body.indexOf("csf_lock_identity_mutation(");
      const authorization = body.indexOf("csf_assert_import_actor");
      expect(identity, `${name} has no identity lock`).toBeGreaterThan(-1);
      expect(authorization, `${name} has no post-lock actor check`).toBeGreaterThan(
        identity,
      );

      for (const laterLock of ["FOR UPDATE", "FOR SHARE", "pg_advisory_xact_lock"]) {
        const position = body.indexOf(laterLock);
        if (position >= 0) {
          expect(
            identity,
            `${name} takes ${laterLock} before the identity lock`,
          ).toBeLessThan(position);
        }
      }
    }
  });

  test("existing profile targets are locked active before delegated writes", () => {
    const helper = functionBody("csf_lock_active_import_profiles");
    expect(helper).toContain("record_status = 'active'");
    expect(helper).toContain("ORDER BY profile.id");
    expect(helper).toContain("FOR UPDATE");

    for (const name of [
      "csf_claim_import_commit_attempt",
      "csf_commit_import_row_for_attempt",
      "csf_reconcile_sheet_import_row",
      "csf_commit_meeting_attendance_import",
      "csf_commit_partner_audit_import",
      "csf_import_class_history_row",
      "csf_import_class_history_row_v2",
      "csf_import_student_roster_row",
      "csf_import_application_response_row",
    ]) {
      const body = functionBody(name);
      expect(body, `${name} does not reject merged targets`).toContain(
        "csf_lock_active_import_profiles(",
      );
    }
  });

  test("internal historical bodies are unreachable and canonical signatures stay service-only", () => {
    for (const name of [
      "csf_commit_import_row_for_attempt_identity_base",
      "csf_reconcile_sheet_import_row_identity_base",
      "csf_commit_meeting_attendance_import_identity_base",
      "csf_commit_partner_audit_import_identity_base",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION plugin_data.${name}`);
    }
    for (const name of IMPORT_IDENTITY_BOUNDARIES) {
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION plugin_data.${name}`,
      );
    }
    expect(migration).not.toContain(" TO anon");
    expect(migration).not.toContain(" TO authenticated");
  });

  test("real dblink races cover every commit family and tombstone postcondition", () => {
    expect(raceTest).toContain("CREATE EXTENSION IF NOT EXISTS dblink");
    expect(raceTest.match(/dblink_send_query/g)?.length ?? 0).toBeGreaterThanOrEqual(
      4,
    );
    for (const name of [
      "csf_commit_import_row_for_attempt",
      "csf_reconcile_sheet_import_row",
      "csf_commit_meeting_attendance_import",
      "csf_commit_partner_audit_import",
    ]) {
      expect(raceTest).toContain(name);
    }
    expect(raceTest).toContain("record_status = 'merged'");
    expect(raceTest).toContain("zero live references remain on merged sources");
  });
});
