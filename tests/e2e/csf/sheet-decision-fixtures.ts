import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";

/**
 * Fixture plumbing for the Sheets application-review journeys.
 *
 * Nothing here talks to Google. The product's Sync button needs a bound Drive
 * token, which an isolated stack does not have, so these helpers stage rows
 * through `csf_stage_sheet_application_decisions` with synthetic evidence. That
 * is the same RPC the action calls once it has read a workbook, so the staged
 * state under test is the real one. The spec still exercises the Sync button to
 * prove it reports a source failure rather than claiming a finished review.
 *
 * Two things about cleanup, both deliberate.
 *
 * Sync runs, source evidence, row evidence, and release receipts reject DELETE
 * with SQLSTATE 55000 by design, so a run of this spec is additive on the
 * disposable isolated stack. Repeat runs stay correct because every run id is
 * fresh and the stage table is keyed on the application, not the run.
 *
 * The applications carry fixed ids so a repeat run re-stages the same rows
 * instead of growing the roster. `resetSheetDecisionFixture` puts the term and
 * those rows back to a known start, which is what makes the journeys below
 * independent of whichever one ran last.
 */

/** Recognisable in the roster and unique to this spec. */
export const SHEET_FIXTURE_PREFIX = "E2E Sheet Review";

const ID = (suffix: string) => `e2e5ee70-0000-4000-8000-0000000000${suffix}`;

export const SHEET_FIXTURE_IDS = {
  source: ID("01"),
  acceptedProfile: ID("10"),
  rejectedProfile: ID("11"),
  explainedProfile: ID("12"),
  unreviewedProfile: ID("13"),
  blockedProfile: ID("14"),
  acceptedApplication: ID("20"),
  rejectedApplication: ID("21"),
  explainedApplication: ID("22"),
  unreviewedApplication: ID("23"),
  blockedApplication: ID("24"),
} as const;

/** The reason text an officer typed in the workbook for the yellow row. */
export const EXPLAINED_REASON =
  "Fictional synthetic reason: transcript page two was unreadable.";

export type SheetDecisionFixture = {
  admin: SupabaseClient;
  organizationId: string;
  termId: string;
  cohortId: string;
  /** An actor holding every CSF permission, used for the seeding RPCs. */
  adviserUserId: string;
};

type Applicant = {
  key: keyof typeof SHEET_FIXTURE_IDS;
  profileId: string;
  applicationId: string;
  lastName: string;
  responseId: string;
  rowNumber: number;
};

/**
 * One applicant per outcome the roster has to render differently. Row numbers
 * are workbook coordinates and never identity; matching runs on `responseId`.
 */
export const APPLICANTS: Record<
  "accepted" | "rejected" | "explained" | "unreviewed" | "blocked",
  Applicant
> = {
  accepted: {
    key: "acceptedApplication",
    profileId: SHEET_FIXTURE_IDS.acceptedProfile,
    applicationId: SHEET_FIXTURE_IDS.acceptedApplication,
    lastName: `${SHEET_FIXTURE_PREFIX} Green`,
    responseId: "e2e-sheet-response-green",
    rowNumber: 11,
  },
  rejected: {
    key: "rejectedApplication",
    profileId: SHEET_FIXTURE_IDS.rejectedProfile,
    applicationId: SHEET_FIXTURE_IDS.rejectedApplication,
    lastName: `${SHEET_FIXTURE_PREFIX} Red`,
    responseId: "e2e-sheet-response-red",
    rowNumber: 12,
  },
  explained: {
    key: "explainedApplication",
    profileId: SHEET_FIXTURE_IDS.explainedProfile,
    applicationId: SHEET_FIXTURE_IDS.explainedApplication,
    lastName: `${SHEET_FIXTURE_PREFIX} Yellow`,
    responseId: "e2e-sheet-response-yellow",
    rowNumber: 13,
  },
  unreviewed: {
    key: "unreviewedApplication",
    profileId: SHEET_FIXTURE_IDS.unreviewedProfile,
    applicationId: SHEET_FIXTURE_IDS.unreviewedApplication,
    lastName: `${SHEET_FIXTURE_PREFIX} Uncolored`,
    responseId: "e2e-sheet-response-uncolored",
    rowNumber: 14,
  },
  blocked: {
    key: "blockedApplication",
    profileId: SHEET_FIXTURE_IDS.blockedProfile,
    applicationId: SHEET_FIXTURE_IDS.blockedApplication,
    lastName: `${SHEET_FIXTURE_PREFIX} YellowNoReason`,
    responseId: "e2e-sheet-response-yellow-blank",
    rowNumber: 15,
  },
};

function checked<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function loadSheetDecisionFixture(): Promise<SheetDecisionFixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plugin = admin.schema("plugin_data");

  const organization = checked(
    await admin
      .from("organizations")
      .select("id")
      .eq("username", "dvhs-csf")
      .single(),
  );
  const organizationId = String(organization!.id);

  const term = checked(
    await plugin
      .from("csf_terms")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("code", "S26")
      .single(),
  );
  const cohort = checked(
    await plugin
      .from("csf_cohorts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("graduation_year", 2028)
      .single(),
  );
  const adviser = checked(
    await admin
      .from("profiles")
      .select("id")
      .eq("email", "csf.adviser@local.test")
      .single(),
  );

  return {
    admin,
    organizationId,
    termId: String(term!.id),
    cohortId: String(cohort!.id),
    adviserUserId: String(adviser!.id),
  };
}

function rpc(
  fixture: SheetDecisionFixture,
  name: string,
  args: Record<string, unknown>,
) {
  return fixture.admin.schema("plugin_data").rpc(name, args);
}

/** Flip the term between app review and Sheet review through the real RPC. */
export async function setReviewSource(
  fixture: SheetDecisionFixture,
  reviewSource: "app" | "sheet",
) {
  checked(
    await rpc(fixture, "csf_set_term_application_review_source", {
      p_organization_id: fixture.organizationId,
      p_actor_user_id: fixture.adviserUserId,
      p_term_id: fixture.termId,
      p_review_source: reviewSource,
      p_request_id: crypto.randomUUID(),
    }),
  );
}

/**
 * The registered response workbook. Its spreadsheet id is fictional and is
 * never fetched: the Sync button's own failure against it is part of the test.
 */
async function upsertSource(fixture: SheetDecisionFixture) {
  const plugin = fixture.admin.schema("plugin_data");
  checked(
    await plugin.from("csf_sheet_sources").upsert(
      {
        id: SHEET_FIXTURE_IDS.source,
        organization_id: fixture.organizationId,
        cohort_id: null,
        title: `${SHEET_FIXTURE_PREFIX} responses`,
        provider: "google_sheets",
        source_type: "application_responses",
        spreadsheet_id: "e2e-fictional-spreadsheet-id",
        drive_file_id: "e2e-fictional-drive-file-id",
        sync_mode: "manual",
        tab_mappings: [
          {
            tabName: "Form Responses 1",
            rangeA1: "A1:AZ600",
            headerRow: 1,
          },
        ],
        settings: { sourceKind: "application_responses" },
      },
      { onConflict: "id" },
    ),
  );

  // The decision column mapping lives in its own table now, and an unconfigured
  // source reads nothing at all, so this has to go through the RPC rather than
  // into settings.
  checked(
    await rpc(fixture, "csf_set_application_decision_mapping", {
      p_organization_id: fixture.organizationId,
      p_actor_user_id: fixture.adviserUserId,
      p_source_id: SHEET_FIXTURE_IDS.source,
      p_decision_columns: [7],
      p_reason_columns: [8],
      p_reads_cell_note: true,
    }),
  );
}

/**
 * `csf_term_applications` carries a BEFORE INSERT guard that refuses a new
 * application unless the term is accepting them, and `accepts_new_applications`
 * defaults to false. Creating this spec's applicants therefore needs intake open
 * for the length of the insert. The review freeze on the same table does not get
 * in the way: it returns early when `auth.uid()` is null, which is the case for
 * this service-role client.
 */
async function withIntakeOpen<T>(
  fixture: SheetDecisionFixture,
  work: () => Promise<T>,
): Promise<T> {
  const plugin = fixture.admin.schema("plugin_data");
  const term = checked(
    await plugin
      .from("csf_terms")
      .select("accepts_new_applications")
      .eq("organization_id", fixture.organizationId)
      .eq("id", fixture.termId)
      .single(),
  ) as { accepts_new_applications: boolean };

  const setIntake = (accepts: boolean) =>
    rpc(fixture, "csf_set_application_intake", {
      p_organization_id: fixture.organizationId,
      p_term_id: fixture.termId,
      p_accepts_new_applications: accepts,
      p_actor_user_id: fixture.adviserUserId,
    });

  if (!term.accepts_new_applications) checked(await setIntake(true));
  try {
    return await work();
  } finally {
    if (!term.accepts_new_applications) checked(await setIntake(false));
  }
}

async function upsertApplicants(fixture: SheetDecisionFixture) {
  const plugin = fixture.admin.schema("plugin_data");
  const applicants = Object.values(APPLICANTS);

  checked(
    await plugin.from("csf_profiles").upsert(
      applicants.map((applicant) => ({
        id: applicant.profileId,
        organization_id: fixture.organizationId,
        first_name: "Fictional",
        last_name: applicant.lastName,
        // Both normalized columns are NOT NULL with no default, and the atomic
        // write RPCs are what usually fill them. A direct fixture insert has to
        // supply them, the same way the seed plan does.
        normalized_first_name: "fictional",
        normalized_last_name: applicant.lastName.toLowerCase(),
        record_status: "active",
        personal_email: `${applicant.responseId}@example.test`,
        normalized_personal_email: `${applicant.responseId}@example.test`,
      })),
      { onConflict: "id" },
    ),
  );

  // The Applications roster is scoped by class, so a profile with no cohort
  // membership never appears in it however its application is filtered.
  checked(
    await plugin.from("csf_profile_cohort_memberships").upsert(
      applicants.map((applicant) => ({
        organization_id: fixture.organizationId,
        profile_id: applicant.profileId,
        cohort_id: fixture.cohortId,
        status: "active",
      })),
      { onConflict: "profile_id,cohort_id" },
    ),
  );

  await withIntakeOpen(fixture, async () =>
    checked(
      await plugin.from("csf_term_applications").upsert(
        applicants.map((applicant) => ({
          id: applicant.applicationId,
          organization_id: fixture.organizationId,
          profile_id: applicant.profileId,
          cohort_id: fixture.cohortId,
          term_id: fixture.termId,
          source: "google_form_sheet",
          // Every run starts undecided. Release is the only thing that moves this.
          status: "submitted",
          current_grade_level: 10,
          returning_status: "new",
          most_checked_email: `${applicant.responseId}@example.test`,
          google_form_response_id: applicant.responseId,
          list_i_points: 5,
          list_i_ii_points: 3,
          grand_total_points: 8,
          submitted_at: "2026-01-09T18:00:00-08:00",
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null,
        })),
        { onConflict: "id" },
      ),
    ),
  );

  // Membership is the access fact the release journey watches. Clear it so a
  // repeat run cannot inherit the previous run's published outcome.
  checked(
    await plugin
      .from("csf_term_memberships")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("term_id", fixture.termId)
      .in(
        "profile_id",
        applicants.map((applicant) => applicant.profileId),
      ),
  );
}

type StageStatus =
  | "accepted"
  | "rejected"
  | "rejected_with_explanation"
  | "unreviewed"
  | "conflict";

export type StageRow = {
  applicant: Applicant;
  status: StageStatus;
  observedColor: string | null;
  reason?: string | null;
};

/**
 * Stage decisions exactly as a completed Sheet read would. The evidence entry
 * is a synthetic but complete receipt: the database records what was read, and
 * the officer surface reports from those rows rather than from anything the
 * caller claims.
 */
export async function stageDecisions(
  fixture: SheetDecisionFixture,
  rows: StageRow[],
) {
  const mappingVersion = await currentMappingVersion(fixture);
  const readAt = new Date().toISOString();
  return checked(
    await rpc(fixture, "csf_stage_sheet_application_decisions", {
      p_organization_id: fixture.organizationId,
      p_actor_user_id: fixture.adviserUserId,
      p_term_id: fixture.termId,
      p_run_id: crypto.randomUUID(),
      p_evidence: [
        {
          sourceId: SHEET_FIXTURE_IDS.source,
          sheetTabName: "Form Responses 1",
          readStatus: "read",
          message: null,
          spreadsheetFileId: "e2e-fictional-drive-file-id",
          spreadsheetTitle: `${SHEET_FIXTURE_PREFIX} responses`,
          providerVersion: `e2e-${readAt}`,
          sheetTabId: 1234567,
          requestedRange: "A1:AZ600",
          contentHash: `e2e-content-${readAt}`,
          mappingVersion,
          decisionColumns: [7],
          reasonColumns: [8],
          readAt,
        },
      ],
      p_rows: rows.map((row) => ({
        sourceId: SHEET_FIXTURE_IDS.source,
        sheetTabName: "Form Responses 1",
        observedRowNumber: row.applicant.rowNumber,
        applicationId: row.applicant.applicationId,
        importRowId: null,
        responseId: row.applicant.responseId,
        responseSubmittedAt: null,
        status: row.status,
        observedColor: row.observedColor,
        reason: row.reason ?? null,
        blockReason: null,
        identityDigest: `e2e-identity-${row.applicant.responseId}`,
        decisionDigest: `e2e-decision-${row.applicant.responseId}-${row.status}`,
        sheetTabId: 1234567,
        changed: true,
        blocksRelease: false,
      })),
    }),
  ) as { runId: string; counts: Record<string, number> };
}

async function currentMappingVersion(fixture: SheetDecisionFixture) {
  const mappings = checked(
    await rpc(fixture, "csf_list_application_decision_mappings", {
      p_organization_id: fixture.organizationId,
      p_actor_user_id: fixture.adviserUserId,
    }),
  ) as Array<{ sourceId: string; mappingVersion: number | null }>;
  const mine = mappings.find(
    (entry) => entry.sourceId === SHEET_FIXTURE_IDS.source,
  );
  if (!mine?.mappingVersion) {
    throw new Error("The fixture source has no decision mapping version.");
  }
  return String(mine.mappingVersion);
}

/** Publish the releasable staged rows through the real release RPC. */
export async function releaseDecisions(fixture: SheetDecisionFixture) {
  return checked(
    await rpc(fixture, "csf_release_sheet_application_decisions", {
      p_organization_id: fixture.organizationId,
      p_actor_user_id: fixture.adviserUserId,
      p_term_id: fixture.termId,
      p_request_id: crypto.randomUUID(),
      p_application_ids: null,
    }),
  ) as {
    released: number;
    accepted: number;
    rejected: number;
    pending: number;
    held: Array<{ applicationId: string; blockReason: string }>;
    heldCount: number;
  };
}

/** The published application status and term membership for one applicant. */
export async function publishedState(
  fixture: SheetDecisionFixture,
  applicant: Applicant,
) {
  const plugin = fixture.admin.schema("plugin_data");
  const application = checked(
    await plugin
      .from("csf_term_applications")
      .select("status")
      .eq("organization_id", fixture.organizationId)
      .eq("id", applicant.applicationId)
      .single(),
  ) as { status: string };
  const membership = checked(
    await plugin
      .from("csf_term_memberships")
      .select("status")
      .eq("organization_id", fixture.organizationId)
      .eq("term_id", fixture.termId)
      .eq("profile_id", applicant.profileId)
      .maybeSingle(),
  ) as { status: string } | null;
  return {
    applicationStatus: application.status,
    membershipStatus: membership?.status ?? null,
  };
}

export async function termState(fixture: SheetDecisionFixture) {
  return checked(
    await rpc(fixture, "csf_sheet_application_decision_term_state", {
      p_organization_id: fixture.organizationId,
      p_actor_user_id: fixture.adviserUserId,
      p_term_id: fixture.termId,
    }),
  ) as {
    reviewSource: string;
    releaseCount: number;
    counts: Record<string, number>;
  };
}

/**
 * Put the term and this spec's applicants back to a known start: Sheet review
 * on, workbook registered and mapped, five undecided applications, no
 * membership. Staged rows from a previous run are overwritten by the next
 * `stageDecisions` call, and the immutable evidence from that run stays as
 * history, which is what the schema intends.
 */
export async function resetSheetDecisionFixture(fixture: SheetDecisionFixture) {
  await setReviewSource(fixture, "sheet");
  await upsertSource(fixture);
  await upsertApplicants(fixture);
}

/** Hand the semester back to in-app review so other specs see the seed state. */
export async function restoreAppReview(fixture: SheetDecisionFixture) {
  await setReviewSource(fixture, "app");
}
