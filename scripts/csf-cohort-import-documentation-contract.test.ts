import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Focused contracts for the DVHS cohort-import boundary and the profile-first
 * Class of 2030 application handoff. These assertions deliberately read both
 * operator prose and implementation sources so obsolete roster seeding or
 * unsupported profile-creation claims cannot return unnoticed.
 */

const repositoryRoot = join(import.meta.dir, "..");

function readRepositoryFile(name: string) {
  return readFileSync(join(repositoryRoot, name), "utf8");
}

function readDoc(name: string) {
  return readRepositoryFile(join("docs/csf", name));
}

function flow(text: string) {
  return text.replace(/\s+/gu, " ");
}

function between(text: string, start: string, end: string) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return text.slice(startIndex, endIndex);
}

function expectInOrder(text: string, labels: string[]) {
  let cursor = 0;
  for (const label of labels) {
    const nextIndex = text.indexOf(label, cursor);
    expect(nextIndex).toBeGreaterThanOrEqual(cursor);
    cursor = nextIndex + label.length;
  }
}

const operatorGuide = flow(readDoc("dvhs-fall-2026-operator-guide.md"));
const officerRunbook = flow(readDoc("officer-runbook.md"));
const newChapterOnboarding = flow(readDoc("new-chapter-onboarding.md"));
const sourceData = flow(readDoc("source-data.md"));
const productContract = flow(readDoc("product-contract.md"));
const dataArchitecture = flow(readRepositoryFile("docs/architecture/data.md"));
const profileWriteMigration = flow(
  readRepositoryFile(
    "supabase/migrations/20260801234028_dvhs_csf_atomic_profile_write.sql",
  ),
);
const importCommitRecoveryMigration = flow(
  readRepositoryFile(
    "supabase/migrations/20260730001004_dvhs_csf_import_commit_recovery.sql",
  ),
);
const importRowsAction = flow(
  readRepositoryFile(
    "lib/plugins/private/plugins/dvhs-csf/server/actions/import-rows.ts",
  ),
);

describe("CSF cohort import documentation truthfulness guards", () => {
  test("the approved historical sheets preserve preview and commit boundaries", () => {
    const sourceOrder = between(
      operatorGuide,
      "## Import the reviewed Fall 2026 starting records",
      "### Connect Google first",
    );
    expectInOrder(sourceOrder, [
      "Class of 2027",
      "Class of 2028",
      "Class of 2029",
    ]);
    expect(sourceOrder).toContain("**Historical records**");
    expect(sourceOrder).toContain(
      "Do not use the Spring 2026 application response workbook as a Fall 2026 roster seed",
    );
    expect(sourceOrder).toContain(
      "**Preview**, **Reconcile**, and **Commit** are separate boundaries",
    );
    expect(sourceOrder).toContain(
      "a clean preview neither imports rows nor authorizes a commit",
    );
    expect(sourceOrder).toContain(
      "Choose **Historical records**, never **Student roster** or **Applications**",
    );
  });

  test("the operator import scope covers Classes of 2027 through 2030", () => {
    const sourceOrder = between(
      operatorGuide,
      "## Import the reviewed Fall 2026 starting records",
      "### Connect Google first",
    );
    expectInOrder(sourceOrder, [
      "Class of 2027",
      "Class of 2028",
      "Class of 2029",
    ]);
    expect(sourceOrder).toContain("semester-tab discovery");
    expect(sourceOrder).toContain("every populated canonical semester tab");
    expect(sourceOrder).toContain("own immutable preview");
    expect(sourceOrder).toContain(
      "Header-only or template tabs are not import targets",
    );
    expect(sourceOrder).toContain("Class of 2026 is out of scope");
    expect(sourceOrder).toContain("template-only Class of 2030 workbook");
    expect(sourceOrder).toContain("new application cycle");
    expect(sourceOrder).not.toContain("Classes of 2027–2030 sheets");

    const springReferenceTotals = between(
      operatorGuide,
      "### Privacy-safe Spring 2026 reference totals",
      "## Set up Fall 2026 policy",
    );
    expectInOrder(springReferenceTotals, [
      "| 2027",
      "`S26`",
      "`A1:O168`",
      "167",
      "| 2028",
      "`S26`",
      "`A1:O168`",
      "167",
      "| 2029",
      "`S26`",
      "`A1:N89`",
      "88",
    ]);
    expect(springReferenceTotals).toContain(
      "not the complete historical import scope",
    );

    const legacySeed = between(
      officerRunbook,
      "### 10.2 Legacy data seed",
      "### 10.3 Student rollout",
    );
    expect(legacySeed).toContain("Class of 2026 is out of scope");
    expect(legacySeed).toContain(
      "Empty Class of 2030 tabs remain linked but create no profiles",
    );
    expect(legacySeed).toContain(
      "header-only future tabs remain linked as empty templates",
    );
    expect(sourceData).toContain(
      "12th → Class of 2026 (out of scope; do not import)",
    );
  });

  test("historical imports are not documented as account-connection evidence", () => {
    const sourceTotals = between(
      operatorGuide,
      "### Privacy-safe Spring 2026 reference totals",
      "## Set up Fall 2026 policy",
    );
    expect(sourceTotals).toContain(
      "historical evidence, not account-connection evidence",
    );
    expect(sourceTotals).toContain(
      "Account connections require current canonical evidence",
    );
  });

  test("new-chapter onboarding cannot restore the obsolete application-response roster seed", () => {
    const legacyImport = between(
      newChapterOnboarding,
      "## Stage 4 — Legacy import",
      "## Stage 5 — Communications setup",
    );
    expect(legacyImport).toMatch(
      /Application responses never seed student identities[.:]/u,
    );
    expect(legacyImport).toContain("**Student roster**");
    expect(legacyImport).toContain("**Historical records**");
    expect(legacyImport).toContain(
      "the only historical student imports are the approved Class of 2027–2029",
    );
    expect(legacyImport).toContain("semester-tab discovery");
    expect(legacyImport).toContain("every populated canonical semester tab");
    expect(legacyImport).toContain("separate immutable preview");
    expect(legacyImport).toContain("Class of 2026 is out of scope");
    expect(legacyImport).toContain(
      "the Class of 2030 workbook has no import job",
    );
    expect(legacyImport).not.toContain(
      "an application-responses import for the earliest term you are seeding",
    );
    expect(legacyImport).not.toContain(
      "roster counts match the application grade distribution",
    );
    expect(importCommitRecoveryMigration).toContain(
      "Roster and class-history imports are the two sources that may create a member",
    );
  });

  test("Class of 2030 documents audited profile creation before application resolution", () => {
    const class2030 = between(
      operatorGuide,
      "## Create and resolve Class of 2030 from the new application cycle",
      "## Set up Fall 2026 policy",
    );
    expectInOrder(class2030, [
      "**Applications**",
      "**Preview normalized rows**",
      "**Members → Add member**",
      "**Add a student record**",
      "**Class** = Class of 2030",
      "**Student record created.**",
      "**Match to member**",
      "**Match reason**",
      "**Use match**",
      "**Verify source and commit**",
      "**Applications → Review queue**",
      "**Approve application**",
    ]);
    expect(class2030).toContain(
      "An application response never creates a student profile",
    );
    expect(class2030).toContain(
      "Profile creation and import-row reconciliation are two separate audited actions",
    );
    expect(class2030).toContain(
      "A targetless application row cannot be committed",
    );
    expect(class2030).toContain(
      "Approving the application creates or updates term membership; it does not create the profile",
    );
    expect(class2030).toContain(
      "Never select, preview, or import the Class of 2030 workbook",
    );

    const applicationCycle = between(
      newChapterOnboarding,
      "### New application cycle when no profile exists",
      "## Stage 7 — First-term operation",
    );
    expect(applicationCycle).toContain(
      "The application response does not create the profile",
    );
    expect(applicationCycle).toContain(
      "the application decision does not create the profile",
    );
    expect(applicationCycle).toContain(
      "the Class of 2030 workbook remains unimported",
    );
    expect(profileWriteMigration).toContain(
      "WHERE action IN ('profile.create', 'profile.edit')",
    );
    expect(profileWriteMigration).toContain(
      "CASE WHEN v_operation = 'create' THEN 'profile_created' ELSE 'profile_edited' END",
    );
    expect(importCommitRecoveryMigration).toContain(
      "An application never brings a member into being.",
    );
    expect(importCommitRecoveryMigration).toContain(
      "This application row has no reviewed CSF member to attach to. Resolve it to an existing member before importing.",
    );
    expect(importRowsAction).toContain(
      "Enter a match reason of at least 4 characters.",
    );
    expect(importRowsAction).toContain(
      "Keep the match reason to 500 characters or fewer.",
    );
    expect(dataArchitecture).toContain(
      "The provided Class of 2030 source is header-only with 0 data rows",
    );
    expect(dataArchitecture).toContain(
      "Operationally it is template-only: do not import it",
    );
    expect(dataArchitecture).toContain(
      "ordinary member and application paths, or the audited semester-correction path",
    );
    expect(productContract).toContain(
      "One atomic server transaction updates the application decision, creates/updates the term membership when approved",
    );
  });

  test("cohort rollout requires current email evidence before account connection", () => {
    // The guide reorganized this material into "Resolve the connection queue".
    const cohortLink = between(
      operatorGuide,
      "## Resolve the connection queue",
      "## Make a connected person an officer",
    );
    expect(cohortLink).toContain(
      "the historical class sheets do not supply reliable account emails",
    );
    expect(cohortLink).toContain(
      "approved current application cycle or another reviewed current source",
    );
    expect(cohortLink).toContain("audited member-correction workflow");
    expect(cohortLink).toContain(
      "Never backfill an address from the Spring 2026 comparison workbook",
    );
    expect(cohortLink).toContain(
      "**Connect account** is withheld until canonical evidence can be read again",
    );

    const studentRollout = between(
      officerRunbook,
      "### 10.3 Student rollout",
      "### 10.4 Posts and announcement email",
    );
    expectInOrder(studentRollout, [
      "current, unique school or personal email",
      "current approved application cycle",
      "audited member-correction workflow",
      // The four Classroom-style onboarding links were replaced by one
      // permanent join code per graduating class, confirmed from Invite
      // students. The section heading says so outright.
      "permanent join code from **Invite students**",
    ]);
    expect(studentRollout).toContain(
      "The historical class sheet alone can never produce that result",
    );
    expect(studentRollout).toContain("**Connect account** remains unavailable");
    expect(productContract).toContain(
      "A student-specific link may use only a current, unique school or personal email recorded on the selected active profile",
    );
  });
});
