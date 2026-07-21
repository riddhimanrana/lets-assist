import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const seedSource = readFileSync(
  new URL("./seed-platform.mjs", import.meta.url),
  "utf8",
);
const actorHelperSource = readFileSync(
  new URL("../../tests/csf/helpers.ts", import.meta.url),
  "utf8",
);

function sourceSection(startMarker: string, endMarker: string) {
  const start = seedSource.indexOf(startMarker);
  const end = seedSource.indexOf(endMarker, start);
  expect(start, `Missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(
    0,
  );
  expect(end, `Missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return seedSource.slice(start, end);
}

function occurrenceCount(source: string, value: string) {
  return source.split(value).length - 1;
}

describe("local platform seed authorization", () => {
  test("V47: preserves the distinction between organization admin and platform super-admin", () => {
    expect(seedSource).toContain("superAdmin: true");
    expect(seedSource).toContain('role: "super_admin"');
    expect(seedSource).toContain("is_super_admin: true");
    expect(seedSource).toContain('roles: ["admin", "admin", "admin", "admin"]');
  });

  test("V43: repeat seeding preserves immutable CSF history", () => {
    const resetList = seedSource.slice(
      seedSource.indexOf("const csfTablesToReset"),
      seedSource.indexOf("for (const table of csfTablesToReset"),
    );
    expect(resetList).not.toContain('"csf_admin_audit_events"');
    expect(resetList).not.toContain('"csf_staff_position_history"');
    expect(resetList).not.toContain('"csf_terms"');
    expect(seedSource).toContain("ignoreDuplicates: true");
  });

  test("resets every mutable lifecycle table before reseeding the CSF fixture", () => {
    const resetList = seedSource.slice(
      seedSource.indexOf("const csfTablesToReset"),
      seedSource.indexOf("for (const table of csfTablesToReset"),
    );
    for (const table of [
      "csf_storage_deletion_queue",
      "csf_application_correction_requests",
      "csf_application_private_notes",
      "csf_application_checks",
      "csf_dues_records",
      "csf_term_reopen_events",
      "csf_term_membership_outcomes",
      "csf_term_deadlines",
      "csf_term_policy_drafts",
    ]) {
      expect(resetList).toContain(`"${table}"`);
    }
    expect(resetList.indexOf('"csf_term_membership_outcomes"')).toBeLessThan(
      resetList.indexOf('"csf_term_memberships"'),
    );
    expect(resetList.indexOf('"csf_term_policy_drafts"')).toBeLessThan(
      resetList.indexOf('"csf_term_policies"'),
    );
  });

  test("seeds one local staff actor for every distinct CSF permission template", () => {
    const accountsSource = sourceSection(
      "const accounts = [",
      "const pluginKeys = [",
    );
    const staffActorKeys = [
      "csfAdviser",
      "csfCoPresidentOne",
      "csfCoPresidentTwo",
      "csfVpMembership",
      "csfVpPublicity",
      "csfVpClubs",
      "csfTreasurer",
      "csfSecretary",
      "csfWebMaster",
      "csfOfficer",
      "csfActivityCoordinatorTwo",
      "csfActivityCoordinatorThree",
      "csfActivityCoordinatorFour",
      "csfActivityCoordinatorFive",
      "csfDataManagement",
    ];

    for (const key of staffActorKeys) {
      const actorStart = accountsSource.indexOf(`key: "${key}"`);
      const actorSource = accountsSource.slice(actorStart, actorStart + 240);
      expect(actorStart, `Missing local actor: ${key}`).toBeGreaterThanOrEqual(
        0,
      );
      expect(actorSource).toContain('roles: [null, null, null, "staff"]');
      expect(actorSource).toContain("@local.test");
    }
  });

  test("keeps the Playwright actor emails aligned with the seeded role accounts", () => {
    const browserActorEmails = [
      "csf.admin@local.test",
      "csf.adviser@local.test",
      "csf.co-president-one@local.test",
      "csf.vp-membership@local.test",
      "csf.vp-publicity@local.test",
      "csf.vp-clubs@local.test",
      "csf.treasurer@local.test",
      "csf.secretary@local.test",
      "csf.web-master@local.test",
      "csf.officer@local.test",
      "csf.data-management@local.test",
      "csf.applicant@local.test",
    ];

    for (const email of browserActorEmails) {
      expect(seedSource).toContain(`email: "${email}"`);
      expect(actorHelperSource).toContain(`email: "${email}"`);
    }
  });

  test("seeds the canonical role templates and preserves their capability boundaries", () => {
    const rolesSource = sourceSection(
      "const seededRoles = [",
      '"csf-expanded-roles"',
    );
    const roleKeys = [
      "owner",
      "advisor",
      "co-president",
      "vice-president-membership",
      "vice-president-publicity",
      "vice-president-clubs",
      "treasurer",
      "secretary",
      "web-master",
      "activity-coordinator",
      "data-management",
    ];

    for (const key of roleKeys) {
      expect(rolesSource).toContain(`key: "${key}"`);
    }

    const treasurerStart = rolesSource.indexOf('key: "treasurer"');
    const treasurerEnd = rolesSource.indexOf("\n    {", treasurerStart);
    const treasurerSource = rolesSource.slice(treasurerStart, treasurerEnd);
    expect(treasurerSource).toContain('"view_applications"');
    expect(treasurerSource).toContain('"manage_payment_review"');
    expect(treasurerSource).toContain('"export_dues_reports"');
    expect(treasurerSource).not.toContain('"decide_applications"');

    const coordinatorStart = rolesSource.indexOf('key: "activity-coordinator"');
    const coordinatorEnd = rolesSource.indexOf("\n    {", coordinatorStart);
    const coordinatorSource = rolesSource.slice(
      coordinatorStart,
      coordinatorEnd,
    );
    expect(coordinatorSource).toContain('"manage_opportunities"');
    expect(coordinatorSource).toContain('"verify_participation"');
    expect(coordinatorSource).not.toContain('"process_points"');
    expect(coordinatorSource).not.toContain('"verify_submissions"');
  });

  test("fills both Co-President seats and all five Activity Coordinator seats idempotently", () => {
    const staffSource = sourceSection(
      '"csf-expanded-staff"',
      "const seededApplications",
    );

    expect(
      occurrenceCount(staffSource, "role_id: IDS.csfRoleCoPresident"),
    ).toBe(2);
    expect(
      occurrenceCount(staffSource, "role_id: IDS.csfRoleActivityCoordinator"),
    ).toBe(5);
    expect(occurrenceCount(staffSource, 'status: "active"')).toBe(15);
    expect(staffSource).toContain('{ onConflict: "id" }');
  });
});
