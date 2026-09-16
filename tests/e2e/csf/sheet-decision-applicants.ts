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
  /** Assigned by `csf_open_import_preview`; "pending" until seeding runs. */
  importJobId: string;
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
      // Workbook coordinates, never identity. Two scenarios do reuse these
      // numbers, which is correct: a row number identifies nothing, and the
      // staging RPC matches on recorded provenance rather than position.
      rowNumber: 100 + index,
      // A placeholder the preview replaces with the row id it assigned. The
      // fixture does not get to choose an import row's identity.
      importRowId:
        matchBasisFor(role) === "import_row_provenance" ? "pending" : null,
      submittedAt: `2026-08-${String(10 + index).padStart(2, "0")}T18:00:00-07:00`,
      email: `e2e.sheet.${role}.${token}@local.test`,
    };
  });

  return {
    scenario: slug,
    token,
    importJobId: "pending",
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
  /** The officer the preview functions record as having started it. */
  actorUserId: string;
};

function checked<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/**
 * The import lineage behind this scenario's applications.
 *
 * `csf_sheet_import_jobs` and `csf_sheet_import_rows` are SELECT-only for the
 * server role: `20260730001004` revoked the inherited `GRANT ALL` precisely
 * because a direct writer could forge a commit job or a terminal row state. The
 * reviewed way in is the three owned preview functions, so that is what this
 * uses. No ACL changes, no reset RPC, no disabled trigger.
 *
 * A preview job is enough. The staging RPC checks the row's `sheet_tab_name`,
 * its job's `source_file_id` and its `matched_application_id`; it does not care
 * whether the job was a preview or a commit, and a preview needs no
 * commit-lineage pointer.
 *
 * `import_status` stays `pending` because a preview row may never claim a
 * commit outcome, which is the whole point of the boundary.
 */
async function seedImportLineage(
  context: SeedContext,
  applicants: SheetApplicants,
) {
  const plugin = context.admin.schema("plugin_data");
  const imported = applicants.all.filter(
    (applicant) => applicant.importRowId !== null,
  );
  if (imported.length === 0) return new Map<string, string>();

  const opened = checked(
    await plugin.rpc("csf_open_import_preview", {
      p_organization_id: context.organizationId,
      p_actor_user_id: context.actorUserId,
      p_source_id: context.sourceId,
      p_source_type: "application_responses",
      p_source_file_id: SHEET_FIXTURE_DRIVE_FILE_ID,
      p_source_file_name: `${SHEET_FIXTURE_PREFIX} responses`,
      p_source_sheet_tab: SHEET_FIXTURE_TAB,
      p_source_range: SHEET_FIXTURE_RANGE,
      p_source_modified_at: new Date().toISOString(),
      p_source_file_metadata: { name: `${SHEET_FIXTURE_PREFIX} responses` },
      p_mapping_snapshot: {
        tabName: SHEET_FIXTURE_TAB,
        rangeA1: SHEET_FIXTURE_RANGE,
        headerRow: 1,
      },
      p_mapping_version: 1,
      p_retry_of_job_id: null,
      p_source_content_hash: `e2e-content-${applicants.token}`,
      p_snapshot_hash: `e2e-snapshot-${applicants.token}`,
      p_snapshot_row_count: imported.length,
      p_snapshot_contract_version: "e2e-1",
    }),
  ) as { previewJobId: string };
  const previewJobId = String(opened.previewJobId);

  checked(
    await plugin.rpc("csf_append_import_preview_rows", {
      p_organization_id: context.organizationId,
      p_actor_user_id: context.actorUserId,
      p_preview_job_id: previewJobId,
      p_rows: imported.map((applicant) => ({
        source_id: context.sourceId,
        cohort_id: context.cohortId,
        term_id: context.termId,
        sheet_tab_name: SHEET_FIXTURE_TAB,
        row_number: applicant.rowNumber,
        source_range: SHEET_FIXTURE_RANGE,
        row_hash: `e2e-row-hash-${applicant.responseId}`,
        matched_profile_id: applicant.profileId,
        matched_application_id: applicant.applicationId,
        import_status: "pending",
        raw_data: { responseId: applicant.responseId },
        normalized_data: { responseId: applicant.responseId },
        mapping_version: 1,
      })),
    }),
  );

  checked(
    await plugin.rpc("csf_seal_import_preview", {
      p_organization_id: context.organizationId,
      p_actor_user_id: context.actorUserId,
      p_preview_job_id: previewJobId,
      p_status: "completed",
      p_summary: { previewRows: imported.length },
    }),
  );

  // The function assigns the row ids, so read them back by the coordinates it
  // was given. The applications then point at the rows that really exist.
  const rows = checked(
    await plugin
      .from("csf_sheet_import_rows")
      .select("id, row_number")
      .eq("organization_id", context.organizationId)
      .eq("job_id", previewJobId),
  ) as Array<{ id: string; row_number: number }>;

  const byRowNumber = new Map(
    rows.map((row) => [String(row.row_number), String(row.id)]),
  );
  for (const applicant of imported) {
    const rowId = byRowNumber.get(String(applicant.rowNumber));
    if (!rowId) {
      throw new Error(
        `The preview did not record a row at ${applicant.rowNumber} for ${applicant.lastName}.`,
      );
    }
    applicant.importRowId = rowId;
  }
  applicants.importJobId = previewJobId;
  return byRowNumber;
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
          // Filled in after the preview runs, because the preview assigns the
          // row ids and a row matches an application that already exists.
          source_import_job_id: null,
          source_import_row_id: null,
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

  await seedImportLineage(context, applicants);

  // The product's identity loader only considers applications that name their
  // import row, so the back-link is what makes these applicants reachable the
  // way a real imported one is.
  for (const applicant of applicants.all) {
    if (!applicant.importRowId) continue;
    checked(
      await plugin
        .from("csf_term_applications")
        .update({
          source_import_job_id: applicants.importJobId,
          source_import_row_id: applicant.importRowId,
        })
        .eq("organization_id", context.organizationId)
        .eq("id", applicant.applicationId),
    );
  }
}
