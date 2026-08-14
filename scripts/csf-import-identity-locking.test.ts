import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const migrationsDirectory = join(repositoryRoot, "supabase/migrations");
const trackedMigrations = readdirSync(migrationsDirectory)
  .filter((filename) => filename.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right))
  .map((filename) => ({
    filename,
    source: readFileSync(join(migrationsDirectory, filename), "utf8"),
  }));
const identityLockMigration = readFileSync(
  join(
    repositoryRoot,
    "supabase/migrations/20260812030000_csf_import_identity_lock_order.sql",
  ),
  "utf8",
);
const privilegeRepairMigration = readFileSync(
  join(
    repositoryRoot,
    "supabase/migrations/20260812065621_csf_import_wrapper_privilege_repair.sql",
  ),
  "utf8",
);
const migration = `${identityLockMigration}\n${privilegeRepairMigration}`;
const migrationLedger = trackedMigrations
  .map(({ filename, source }) => `-- ${filename}\n${source}`)
  .join("\n");
const raceTest = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/csf_import_identity_merge_races.test.sql",
  ),
  "utf8",
);
const applicationImportTest = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/csf_application_import.test.sql",
  ),
  "utf8",
);
const strictPointsTest = readFileSync(
  join(
    repositoryRoot,
    "supabase/tests/database/csf_class_history_strict_points.test.sql",
  ),
  "utf8",
);
const canonicalOfficerFixtures = [
  "csf_application_import.test.sql",
  "csf_class_history_import.test.sql",
  "csf_atomic_import_reconciliation.test.sql",
  "csf_contextual_commit_readiness.test.sql",
  "csf_contextual_commit_evidence.test.sql",
  "csf_contextual_commit_lock_order.test.sql",
  "csf_partner_audit_provenance_state_machine.test.sql",
] as const;

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
  expect(
    start,
    `${name} must be replaced by the forward migration`,
  ).toBeGreaterThan(-1);
  const end = migration.indexOf("\n$$;", start);
  expect(end, `${name} must have a complete body`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

function latestLedgerFunctionBody(name: string) {
  const start = migrationLedger.lastIndexOf(
    `CREATE OR REPLACE FUNCTION plugin_data.${name}(`,
  );
  expect(
    start,
    `${name} must exist in the current migration ledger`,
  ).toBeGreaterThan(-1);
  const end = migrationLedger.indexOf("\n$$;", start);
  expect(end, `${name} must have a complete current body`).toBeGreaterThan(
    start,
  );
  return migrationLedger.slice(start, end);
}

describe("CSF import identity lock hierarchy", () => {
  test("begin and commit share the canonical identity-first outer lock order", () => {
    for (const name of [
      "csf_begin_import_row_for_attempt",
      "csf_commit_import_row_for_attempt",
    ]) {
      const body = latestLedgerFunctionBody(name);
      const identity = body.indexOf("csf_lock_identity_mutation(");
      const authorization = body.indexOf("csf_assert_import_actor_for_job(");
      const activeTargets = body.indexOf("csf_lock_active_import_profiles(");
      const baseOperation = body.indexOf(`${name}_identity_base(`);

      expect(identity, `${name} has no outer identity lock`).toBeGreaterThan(
        -1,
      );
      expect(
        authorization,
        `${name} has no post-identity actor reauthorization`,
      ).toBeGreaterThan(identity);
      expect(
        activeTargets,
        `${name} does not lock active targets after reauthorization`,
      ).toBeGreaterThan(authorization);
      expect(
        baseOperation,
        `${name} does not delegate only after shared outer locks`,
      ).toBeGreaterThan(activeTargets);
    }
  });

  test("transport settlement exposes no caller-selected deterministic outcome", () => {
    const currentFailure = latestLedgerFunctionBody(
      "csf_fail_import_row_for_attempt",
    );
    expect(currentFailure).not.toContain("p_deterministic boolean");
    expect(currentFailure).not.toContain("p_deterministic");
    expect(currentFailure).toContain("'unknown'");
    expect(currentFailure).not.toContain("v_state = 'failed'");

    expect(migrationLedger).toMatch(
      /DROP FUNCTION IF EXISTS plugin_data\.csf_fail_import_row_for_attempt\(\s*uuid,\s*uuid,\s*uuid,\s*text,\s*text,\s*boolean\s*\)/u,
    );
  });

  test("the import/merge race is built only through the supported lifecycle", () => {
    const lifecycleOwnedMutation =
      /\b(?:INSERT\s+INTO|UPDATE)\b[^;]*\b(?:active_commit_attempt_id|commit_frozen_at|commit_outcome_state|commit_attempt_id)\b[^;]*;/giu;
    const directAttemptMutation =
      /\b(?:INSERT\s+INTO|UPDATE)\s+plugin_data\.csf_sheet_import_commit_attempts\b[^;]*;/giu;

    expect(
      raceTest.match(directAttemptMutation) ?? [],
      "the race fixture must obtain attempts only through csf_claim_import_commit_attempt",
    ).toEqual([]);
    expect(
      raceTest.match(lifecycleOwnedMutation) ?? [],
      "the race fixture must not write lifecycle-owned import columns",
    ).toEqual([]);

    for (const lifecycleCall of [
      "csf_issue_uploaded_source_evidence",
      "csf_claim_import_commit_attempt",
      "csf_begin_import_row_for_attempt",
      "csf_commit_import_row_for_attempt",
      "dblink_send_query",
      "dblink_is_busy",
      "csf_merge_profiles",
    ]) {
      expect(
        raceTest,
        `the concurrency proof must call ${lifecycleCall}`,
      ).toContain(lifecycleCall);
    }
  });

  test("never schema-qualifies PostgreSQL syntax-only conditional expressions", () => {
    const syntaxOnlyConditional =
      /\bpg_catalog\.(?:coalesce|nullif|greatest|least)\s*\(/iu;
    const violations = trackedMigrations.flatMap(({ filename, source }) =>
      source
        .split("\n")
        .flatMap((line, index) =>
          syntaxOnlyConditional.test(line) ? [`${filename}:${index + 1}`] : [],
        ),
    );

    expect(violations).toEqual([]);
  });

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
      expect(
        authorization,
        `${name} has no post-lock actor check`,
      ).toBeGreaterThan(identity);

      for (const laterLock of [
        "FOR UPDATE",
        "FOR SHARE",
        "pg_advisory_xact_lock",
      ]) {
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

  test("internal historical bodies and central row primitives stay behind the service fence", () => {
    for (const name of [
      "csf_commit_import_row_for_attempt_identity_base",
      "csf_reconcile_sheet_import_row_identity_base",
      "csf_commit_meeting_attendance_import_identity_base",
      "csf_commit_partner_audit_import_identity_base",
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION plugin_data.${name}`);
    }
    for (const name of [
      "csf_claim_import_commit_attempt",
      "csf_commit_import_row_for_attempt",
      "csf_reconcile_sheet_import_row",
      "csf_commit_meeting_attendance_import",
      "csf_commit_partner_audit_import",
      "csf_import_class_history_row",
    ]) {
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION plugin_data.${name}`,
      );
    }
    for (const name of [
      "csf_import_application_response_row",
      "csf_import_student_roster_row",
      "csf_import_class_history_row_v2",
    ]) {
      expect(privilegeRepairMigration).toContain(
        `REVOKE ALL ON FUNCTION plugin_data.${name}`,
      );
      expect(privilegeRepairMigration).not.toContain(
        `GRANT EXECUTE ON FUNCTION plugin_data.${name}`,
      );
    }
    expect(migration).not.toContain(" TO anon");
    expect(migration).not.toContain(" TO authenticated");
  });

  test("officer fixtures model active membership while validation-only fixtures use the owner delegate", () => {
    for (const fixture of canonicalOfficerFixtures) {
      const source = readFileSync(
        join(repositoryRoot, "supabase/tests/database", fixture),
        "utf8",
      );
      expect(
        source,
        `${fixture} needs an organization officer fixture`,
      ).toContain("INSERT INTO public.organization_members");
    }
    expect(applicationImportTest).toContain("'admin', 'active'");
    expect(applicationImportTest).toContain("'admin', 'removed'");
    expect(applicationImportTest).toContain(
      "an inactive officer cannot act through the application import boundary",
    );
    expect(strictPointsTest).toContain(
      "plugin_data.csf_import_class_history_row_v2_identity_base(",
    );
    expect(strictPointsTest).not.toContain(
      "INSERT INTO public.organization_members",
    );
  });

  test("real dblink races cover every commit family and tombstone postcondition", () => {
    expect(raceTest).toContain("CREATE EXTENSION IF NOT EXISTS dblink");
    expect(
      raceTest.match(/dblink_send_query/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(4);
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
