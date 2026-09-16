import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A fresh cohort of applicants for one scenario, with real workbook provenance.
 *
 * Two constraints force this shape.
 *
 * `csf_application_decision_stages` is keyed `UNIQUE (organization_id,
 * application_id)`, and `service_role` holds `SELECT` on it and nothing else,
 * because every write goes through a reviewed SECURITY DEFINER function. A
 * fixture cannot delete a stage, and widening that ACL to make a test pass
 * would remove the guard the table exists for. So the only way to begin a
 * scenario with no staged decision is to begin it with an application the
 * staging RPC has never seen. `csf_term_applications` is
 * `UNIQUE (profile_id, term_id)`, so a fresh application needs a fresh profile.
 *
 * Nothing is deleted. Previous scenarios' stages, sync runs, row evidence and
 * release receipts stay exactly as the schema intends; a new scenario simply
 * does not collide with them.
 *
 * The scenario token is in the surname too. The roster lists every application
 * in the term, so without it a filter assertion expecting no rows would start
 * matching an earlier scenario's applicant.
 */

export const SHEET_FIXTURE_PREFIX = "E2E Sheet Review";
export const SHEET_FIXTURE_TAB = "Form Responses 1";
export const SHEET_FIXTURE_RANGE = "A1:AZ600";

/**
 * Fictional provider coordinates. Nothing fetches them; the Sync button failing
 * against them is part of the test, and the Drive id is how a repeat run finds
 * the source it registered before.
 */
export const SHEET_FIXTURE_SPREADSHEET_ID = "e2e-fictional-spreadsheet-id";
export const SHEET_FIXTURE_DRIVE_FILE_ID = "e2e-fictional-drive-file-id";

/** The reason text an officer typed in the workbook for the yellow row. */
export const EXPLAINED_REASON =
  "Fictional synthetic reason: transcript page two was unreadable.";

export const APPLICANT_ROLES = [
  "accepted",
  "rejected",
  "explained",
  "unreviewed",
  "blocked",
] as const;

export type ApplicantRole = (typeof APPLICANT_ROLES)[number];

/** The roles whose own member view the applicant spec signs in to check. */
export const LINKED_ROLES = ["accepted", "rejected", "explained"] as const;

export type LinkedApplicantRole = (typeof LINKED_ROLES)[number];

export type SheetApplicant = {
  role: ApplicantRole;
  profileId: string;
  applicationId: string;
  /** Unique to this scenario, so roster filters cannot match a neighbour. */
  lastName: string;
  responseId: string;
  rowNumber: number;
  /**
   * The recorded import row this application came from, or null for the one
   * applicant that deliberately has none. See `matchBasisFor`.
   */
  importRowId: string | null;
  submittedAt: string;
  email: string;
};

export type SheetApplicants = {
  scenario: string;
  token: string;
  importJobId: string;
  previewJobId: string;
  byRole: Record<ApplicantRole, SheetApplicant>;
  all: SheetApplicant[];
};

/**
 * Which provenance branch each applicant proves.
 *
 * The product always sends an import row: `loadCsfTermApplicationIdentities`
 * filters on a non-null `source_import_row_id` and the matcher skips any
 * candidate without one. Four applicants therefore take that path, which is the
 * one the chapter will actually exercise, and the database checks the whole
 * chain: the import row's tab, its job's file id, and its matched application.
 *
 * `explained` carries no import row on purpose, so the recorded-response-id
 * fallback is exercised too, including the submitted-at comparison that is
 * otherwise never reached.
 */
export function matchBasisFor(role: ApplicantRole) {
  return role === "explained"
    ? "recorded_response_id"
    : "import_row_provenance";
}

function shortToken() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

/**
 * Mint one scenario's identities. Call once per scenario and reuse the result
 * for every step inside it: a repeated sync has to address the same applicants,
 * which is the whole point of staging being keyed on the application.
 */
export function allocateSheetApplicants(scenario: string): SheetApplicants {
  const token = shortToken();
  const slug = scenario
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 24);
  const byRole = {} as Record<ApplicantRole, SheetApplicant>;

  APPLICANT_ROLES.forEach((role, index) => {
    byRole[role] = {
      role,
      profileId: randomUUID(),
      applicationId: randomUUID(),
      lastName: `${SHEET_FIXTURE_PREFIX} ${role} ${token}`,
      responseId: `e2e-response-${role}-${token}`,
      // Workbook coordinates, never identity. Offset so two scenarios reading
      // the same sheet do not claim the same row number.
      rowNumber: 100 + index,
      importRowId:
        matchBasisFor(role) === "import_row_provenance" ? randomUUID() : null,
      submittedAt: `2026-08-${String(10 + index).padStart(2, "0")}T18:00:00-07:00`,
      email: `e2e.sheet.${role}.${token}@local.test`,
    };
  });

  return {
    scenario: slug,
    token,
    importJobId: randomUUID(),
    previewJobId: randomUUID(),
    byRole,
    all: APPLICANT_ROLES.map((role) => byRole[role]),
  };
}

type SeedContext = {
  admin: SupabaseClient;
  organizationId: string;
  termId: string;
  cohortId: string;
  sourceId: string;
};

function checked<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/**
 * The import lineage behind this scenario's applications.
 *
 * A commit job has to name the preview it derived from, so both are written.
 * The rows carry the tab and file id the staging RPC re-checks, and
 * `matched_application_id` is what ties a row to its applicant; a row belonging
 * to somebody else is exactly what the database is meant to refuse.
 */
async function seedImportLineage(
  context: SeedContext,
  applicants: SheetApplicants,
) {
  const plugin = context.admin.schema("plugin_data");
  const imported = applicants.all.filter(
    (applicant) => applicant.importRowId !== null,
  );
  if (imported.length === 0) return;

  checked(
    await plugin.from("csf_sheet_import_jobs").upsert(
      [
        {
          id: applicants.previewJobId,
          organization_id: context.organizationId,
          source_id: context.sourceId,
          mode: "preview",
          status: "completed",
          source_file_id: SHEET_FIXTURE_DRIVE_FILE_ID,
        },
        {
          id: applicants.importJobId,
          organization_id: context.organizationId,
          source_id: context.sourceId,
          mode: "commit",
          status: "completed",
          source_file_id: SHEET_FIXTURE_DRIVE_FILE_ID,
          preview_job_id: applicants.previewJobId,
        },
      ],
      { onConflict: "id" },
    ),
  );

  checked(
    await plugin.from("csf_sheet_import_rows").upsert(
      imported.map((applicant) => ({
        id: applicant.importRowId!,
        organization_id: context.organizationId,
        job_id: applicants.importJobId,
        source_id: context.sourceId,
        term_id: context.termId,
        cohort_id: context.cohortId,
        sheet_tab_name: SHEET_FIXTURE_TAB,
        row_number: applicant.rowNumber,
        source_range: SHEET_FIXTURE_RANGE,
        row_hash: `e2e-row-hash-${applicant.responseId}`,
        matched_application_id: applicant.applicationId,
        matched_profile_id: applicant.profileId,
        import_status: "created",
      })),
      { onConflict: "id" },
    ),
  );
}

/**
 * Profiles, class membership, import lineage and applications for one scenario.
 *
 * `withIntake` is the caller's, because opening intake is a term-wide change
 * that has to be put back whichever way this returns.
 */
export async function seedSheetApplicants(
  context: SeedContext,
  applicants: SheetApplicants,
  withIntake: <T>(work: () => Promise<T>) => Promise<T>,
) {
  const plugin = context.admin.schema("plugin_data");

  checked(
    await plugin.from("csf_profiles").upsert(
      applicants.all.map((applicant) => ({
        id: applicant.profileId,
        organization_id: context.organizationId,
        first_name: "Fictional",
        last_name: applicant.lastName,
        // Both normalized columns are NOT NULL with no default; the atomic
        // write RPCs usually fill them, so a direct insert has to.
        normalized_first_name: "fictional",
        normalized_last_name: applicant.lastName.toLowerCase(),
        record_status: "active",
        personal_email: applicant.email,
        normalized_personal_email: applicant.email,
      })),
      { onConflict: "id" },
    ),
  );

  // The roster is scoped by class, so a profile with no class membership never
  // appears in it however the list is filtered.
  checked(
    await plugin.from("csf_profile_cohort_memberships").upsert(
      applicants.all.map((applicant) => ({
        organization_id: context.organizationId,
        profile_id: applicant.profileId,
        cohort_id: context.cohortId,
        status: "active",
      })),
      { onConflict: "profile_id,cohort_id" },
    ),
  );

  await seedImportLineage(context, applicants);

  await withIntake(async () =>
    checked(
      await plugin.from("csf_term_applications").upsert(
        applicants.all.map((applicant) => ({
          id: applicant.applicationId,
          organization_id: context.organizationId,
          profile_id: applicant.profileId,
          cohort_id: context.cohortId,
          term_id: context.termId,
          source: "google_form_sheet",
          // Undecided. Release is the only thing that moves this.
          status: "submitted",
          current_grade_level: 10,
          returning_status: "new",
          most_checked_email: applicant.email,
          google_form_response_id: applicant.responseId,
          // The workbook provenance the staging RPC re-checks. Without it every
          // row fails verification and stages nothing.
          source_file_id: SHEET_FIXTURE_DRIVE_FILE_ID,
          source_file_name: `${SHEET_FIXTURE_PREFIX} responses`,
          source_sheet_tab: SHEET_FIXTURE_TAB,
          source_row_number: applicant.rowNumber,
          source_submitted_at: applicant.submittedAt,
          source_import_job_id: applicant.importRowId
            ? applicants.importJobId
            : null,
          source_import_row_id: applicant.importRowId,
          list_i_points: 5,
          list_i_ii_points: 3,
          grand_total_points: 8,
          submitted_at: applicant.submittedAt,
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null,
        })),
        { onConflict: "id" },
      ),
    ),
  );
}
