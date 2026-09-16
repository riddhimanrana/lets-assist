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

/** The tab and range every mapping, evidence entry, and staged row agrees on. */
export const SHEET_FIXTURE_TAB = "Form Responses 1";
export const SHEET_FIXTURE_RANGE = "A1:AZ600";

/**
 * Fictional provider coordinates, and this spec's own handle on its source.
 * Nothing fetches them; the Sync button failing against them is part of the
 * test. The Drive id is how a repeat run finds the source it registered before.
 */
export const SHEET_FIXTURE_SPREADSHEET_ID = "e2e-fictional-spreadsheet-id";
export const SHEET_FIXTURE_DRIVE_FILE_ID = "e2e-fictional-drive-file-id";

const ID = (suffix: string) => `e2e5ee70-0000-4000-8000-0000000000${suffix}`;

export const SHEET_FIXTURE_IDS = {
  priorTerm: ID("02"),
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
  /** Whichever semester the seed marks current and open, read at load time. */
  termCode: string;
  termStartsAt: string | null;
  cohortId: string;
  /** An actor holding every CSF permission, used for the seeding RPCs. */
  adviserUserId: string;
  /**
   * Assigned by the database when the source is registered, so it is unknown
   * until `resetSheetDecisionFixture` has run.
   */
  sourceId: string | null;
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

  // The semester by policy, not by name. A hardcoded code pinned this spec to
  // Spring 2026, which the seed has since moved past: `csf_set_application_intake`
  // refuses any term but the current open one, so intake failed before the
  // browser ever started. The product's own rule is the one condition that
  // cannot go stale.
  const terms = checked(
    await plugin
      .from("csf_terms")
      .select("id, code, starts_at")
      .eq("organization_id", organizationId)
      .eq("is_current", true)
      .eq("lifecycle_status", "open"),
  ) as Array<{ id: string; code: string; starts_at: string | null }>;
  if (terms.length !== 1) {
    throw new Error(
      `Expected exactly one current open CSF semester, found ${terms.length}. ` +
        "The isolated seed decides which semester is current; this spec does not promote one.",
    );
  }
  const term = terms[0];

  // A class that is actually enrolled in that semester. The roster is scoped by
  // class, so a cohort with no `csf_cohort_terms` row for this term would leave
  // every applicant invisible however the list is filtered.
  const enrolled = checked(
    await plugin
      .from("csf_cohort_terms")
      .select("cohort_id")
      .eq("organization_id", organizationId)
      .eq("term_id", term.id)
      .eq("status", "active"),
  ) as Array<{ cohort_id: string }>;
  if (enrolled.length === 0) {
    throw new Error(
      `The current CSF semester ${term.code} has no active class, so applicants would not appear on any roster.`,
    );
  }
  // The youngest enrolled class, which is where new applicants belong. Picked by
  // graduation year rather than by whichever row came back first, so the roster
  // these applicants land in is the same one on every run.
  const cohortRows = checked(
    await plugin
      .from("csf_cohorts")
      .select("id, graduation_year")
      .eq("organization_id", organizationId)
      .in(
        "id",
        enrolled.map((row) => row.cohort_id),
      )
      .order("graduation_year", { ascending: false })
      .limit(1),
  ) as Array<{ id: string; graduation_year: number }>;
  const cohort = cohortRows[0];
  if (!cohort) {
    throw new Error(
      `The classes enrolled in ${term.code} could not be read, so applicants have no roster to appear in.`,
    );
  }
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
    termId: String(term.id),
    termCode: String(term.code),
    termStartsAt: term.starts_at ? String(term.starts_at) : null,
    cohortId: String(cohort.id),
    adviserUserId: String(adviser!.id),
    sourceId: null,
  };
}

/** Fail loudly rather than staging against a source that was never registered. */
function requireSourceId(fixture: SheetDecisionFixture) {
  if (!fixture.sourceId) {
    throw new Error(
      "The Sheet decision source is not registered yet. Call resetSheetDecisionFixture first.",
    );
  }
  return fixture.sourceId;
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
  // `csf_sheet_sources` grants the server role SELECT and nothing else: every
  // write goes through an owned SECURITY DEFINER RPC. A fixture is not a reason
  // to widen that, so this registers the source the way the product does.
  //
  // The RPC reads `p_source_id` as "reconfigure this existing source" and
  // rejects an id it cannot find, so the fixture cannot choose its own. A null
  // id creates one and returns the generated id, and adoption only arbitrates
  // uploaded files, never a Google source. So: find this spec's own source by
  // the fictional Drive id that identifies it, reconfigure it if it is there,
  // and create it once if it is not.
  const existing = checked(
    await fixture.admin
      .schema("plugin_data")
      .from("csf_sheet_sources")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("drive_file_id", SHEET_FIXTURE_DRIVE_FILE_ID)
      .maybeSingle(),
  ) as { id: string } | null;

  const registered = checked(
    await rpc(fixture, "csf_register_sheet_source", {
      p_organization_id: fixture.organizationId,
      p_actor_user_id: fixture.adviserUserId,
      p_source_id: existing?.id ?? null,
      p_source_type: "application_responses",
      p_registration: {
        title: `${SHEET_FIXTURE_PREFIX} responses`,
        provider: "google_sheets",
        cohortId: null,
        spreadsheetId: SHEET_FIXTURE_SPREADSHEET_ID,
        driveFileId: SHEET_FIXTURE_DRIVE_FILE_ID,
        syncMode: "manual",
        tabMappings: [
          {
            tabName: SHEET_FIXTURE_TAB,
            rangeA1: SHEET_FIXTURE_RANGE,
            headerRow: 1,
          },
        ],
        settings: { sourceKind: "application_responses" },
      },
    }),
  ) as { sourceId: string };

  // Every later helper stages against this exact source, so hold the id the
  // database actually assigned rather than one the fixture wished for.
  fixture.sourceId = String(registered.sourceId);

  // The decision column mapping lives in its own table now, and an unconfigured
  // source reads nothing at all, so this has to go through the RPC rather than
  // into settings. `20260917020100` takes the whole mapping as one jsonb value
  // plus the version the caller believes it is replacing, so a save that
  // arrives after somebody else's is refused rather than merged.
  const existingVersion = await mappingVersionOrNull(fixture);
  checked(
    await rpc(fixture, "csf_set_application_decision_mapping", {
      p_organization_id: fixture.organizationId,
      p_actor_user_id: fixture.adviserUserId,
      p_source_id: fixture.sourceId,
      p_mapping: {
        decisionColumns: [7],
        reasonColumns: [8],
        readsCellNote: true,
        // The response identity the sync matches on, never the student's
        // editable account contact. `responseId` is the column the import
        // froze onto `csf_term_applications.google_form_response_id`.
        identityColumns: { email: 2, submittedAt: 1, responseId: 3 },
        // The frame the column numbers above are relative to. `rangeA1` is the
        // repository-wide spelling, the same one `tabMappings` uses.
        scope: {
          sheetTabName: SHEET_FIXTURE_TAB,
          rangeA1: SHEET_FIXTURE_RANGE,
          headerRow: 1,
        },
        // Explicit allowlists, including the fills that mean nothing: the live
        // workbook bands its rows, and banding is not a verdict.
        colors: {
          accepted: ["#d9ead3"],
          rejected: ["#f4cccc"],
          rejectedWithExplanation: ["#fff2cc"],
          ignoredFills: ["#f8f9fa", "#ffffff"],
        },
      },
      p_expected_version: existingVersion,
    }),
  );
}

/** The stored mapping version for this spec's source, or null when unsaved. */
async function mappingVersionOrNull(fixture: SheetDecisionFixture) {
  const mappings = (checked(
    await rpc(fixture, "csf_list_application_decision_mappings", {
      p_organization_id: fixture.organizationId,
      p_actor_user_id: fixture.adviserUserId,
    }),
  ) ?? []) as Array<{ sourceId: string; mappingVersion: number | null }>;
  return (
    mappings.find((entry) => entry.sourceId === fixture.sourceId)
      ?.mappingVersion ?? null
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
          sourceId: requireSourceId(fixture),
          sheetTabName: SHEET_FIXTURE_TAB,
          readStatus: "read",
          message: null,
          spreadsheetFileId: "e2e-fictional-drive-file-id",
          spreadsheetTitle: `${SHEET_FIXTURE_PREFIX} responses`,
          providerVersion: `e2e-${readAt}`,
          sheetTabId: 1234567,
          requestedRange: SHEET_FIXTURE_RANGE,
          contentHash: `e2e-content-${readAt}`,
          mappingVersion,
          decisionColumns: [7],
          reasonColumns: [8],
          readAt,
        },
      ],
      p_rows: rows.map((row) => ({
        sourceId: requireSourceId(fixture),
        sheetTabName: SHEET_FIXTURE_TAB,
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
  const version = await mappingVersionOrNull(fixture);
  if (!version) {
    throw new Error("The fixture source has no decision mapping version.");
  }
  return String(version);
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
 * Synthetic accounts for the applicants whose own view matters.
 *
 * `unreviewed` is deliberately left out: an applicant with no account is the
 * unlinked journey, and the product has to behave for them too.
 *
 * Every address is under `@local.test`, the password comes from the run-scoped
 * isolated marker, and `loadSheetDecisionFixture` refuses to run at all without
 * a validated isolated stack. There is no path here that could reach a real
 * account.
 */
export const APPLICANT_ACCOUNTS = {
  accepted: "e2e.sheet.green@local.test",
  rejected: "e2e.sheet.red@local.test",
  explained: "e2e.sheet.yellow@local.test",
} as const;

export type LinkedApplicantKey = keyof typeof APPLICANT_ACCOUNTS;

async function findUserByEmail(fixture: SheetDecisionFixture, email: string) {
  const { data, error } = await fixture.admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw new Error(error.message);
  return data.users.find((user) => user.email === email) ?? null;
}

/**
 * Create or refresh one fictional applicant account and link it to that
 * applicant's CSF profile as a verified connection, which is what makes the
 * member surfaces resolve to this person rather than to nobody.
 */
async function upsertApplicantAccount(
  fixture: SheetDecisionFixture,
  key: LinkedApplicantKey,
  password: string,
) {
  const email = APPLICANT_ACCOUNTS[key];
  const applicant = APPLICANTS[key];
  const existing = await findUserByEmail(fixture, email);
  const payload = {
    password,
    email_confirm: true,
    user_metadata: { full_name: `Fictional ${applicant.lastName}` },
  };

  const user = existing
    ? (() => fixture.admin.auth.admin.updateUserById(existing.id, payload))()
    : (() => fixture.admin.auth.admin.createUser({ email, ...payload }))();
  const { data, error } = await user;
  if (error) throw new Error(error.message);
  const userId = data.user!.id;

  // An applicant has to be an organization member to reach the CSF tabs at all.
  checked(
    await fixture.admin.from("organization_members").upsert(
      {
        organization_id: fixture.organizationId,
        user_id: userId,
        role: "member",
        status: "active",
      },
      { onConflict: "organization_id,user_id" },
    ),
  );

  // A verified link is the only thing that makes this session the applicant.
  // A pending claim must not resolve, which is why the status is explicit.
  checked(
    await fixture.admin
      .schema("plugin_data")
      .from("csf_profile_accounts")
      .upsert(
        {
          organization_id: fixture.organizationId,
          profile_id: applicant.profileId,
          user_id: userId,
          status: "verified",
          connection_basis: "officer_decision",
          is_primary: true,
          linked_by: fixture.adviserUserId,
        },
        { onConflict: "organization_id,profile_id,user_id" },
      ),
  );

  return { email, userId };
}

export async function linkApplicantAccounts(
  fixture: SheetDecisionFixture,
  password: string,
) {
  const linked: Record<string, { email: string; userId: string }> = {};
  for (const key of Object.keys(APPLICANT_ACCOUNTS) as LinkedApplicantKey[]) {
    linked[key] = await upsertApplicantAccount(fixture, key, password);
  }
  return linked as Record<
    LinkedApplicantKey,
    { email: string; userId: string }
  >;
}

/**
 * A permitted historical record for one applicant: a completed prior semester.
 * The chapter's rule is that history stays readable while the current term is
 * still unreleased, so the member journeys need something to read.
 */
export async function seedPriorSemesterRecord(
  fixture: SheetDecisionFixture,
  key: LinkedApplicantKey,
) {
  const priorTermId = await ensurePriorTerm(fixture);
  checked(
    await fixture.admin
      .schema("plugin_data")
      .from("csf_term_memberships")
      .upsert(
        {
          organization_id: fixture.organizationId,
          term_id: priorTermId,
          profile_id: APPLICANTS[key].profileId,
          cohort_id: fixture.cohortId,
          // A completed outcome is never revoked by a later sync, which is the
          // invariant this record also guards.
          status: "completed",
          completed_at: "2025-12-19T12:00:00-08:00",
        },
        { onConflict: "organization_id,term_id,profile_id" },
      ),
  );
  return priorTermId;
}

/**
 * The semester the applicants already finished.
 *
 * A seeded past semester is used when the chapter has one, because a term this
 * spec invents would also show up in every other spec's semester picker. Only
 * when there is genuinely no other semester does this create its own, so the
 * history journeys never quietly skip.
 *
 * The owned term is deliberately left `open`: a `closed` term needs a real
 * closure snapshot with a matching `active_closure_id`, and none of these
 * journeys are about term close.
 */
async function ensurePriorTerm(fixture: SheetDecisionFixture) {
  const plugin = fixture.admin.schema("plugin_data");

  // `is_current = false` is not "historical": this chapter is seeded with
  // semesters running out to Spring 2028, and the newest non-current one is in
  // the future. A completed record on a semester that has not started yet is
  // not history, so the term has to actually begin before the current one.
  const seeded = fixture.termStartsAt
    ? ((checked(
        await plugin
          .from("csf_terms")
          .select("id")
          .eq("organization_id", fixture.organizationId)
          .eq("is_current", false)
          .neq("id", fixture.termId)
          .lt("starts_at", fixture.termStartsAt)
          .order("starts_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ) ?? null) as { id: string } | null)
    : null;
  // Only the applicant's membership is written onto a seeded term. Its
  // lifecycle, dates, and current flag are the seed's and stay untouched.
  if (seeded) return String(seeded.id);

  checked(
    await plugin.from("csf_terms").upsert(
      {
        id: SHEET_FIXTURE_IDS.priorTerm,
        organization_id: fixture.organizationId,
        code: "E2EP1",
        label: `${SHEET_FIXTURE_PREFIX} prior semester`,
        school_year: "2025-2026",
        semester: "fall",
        starts_at: "2025-08-18",
        ends_at: "2025-12-19",
        is_current: false,
      },
      { onConflict: "id" },
    ),
  );
  return SHEET_FIXTURE_IDS.priorTerm;
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
