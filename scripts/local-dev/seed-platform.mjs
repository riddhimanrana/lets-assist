#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { getLocalSupabaseEnv } from "./dv-local-env.mjs";

const IDS = {
  primaryOrg: "10000000-0000-4000-8000-000000000001",
  nonprofitOrg: "10000000-0000-4000-8000-000000000002",
  schoolOrg: "10000000-0000-4000-8000-000000000003",
  csfOrg: "10000000-0000-4000-8000-000000000004",
  publicProject: "10000000-0000-4000-8000-000000000020",
  orgProject: "10000000-0000-4000-8000-000000000021",
  csfTermS26: "10000000-0000-4000-8000-000000000101",
  csfTermF25: "10000000-0000-4000-8000-000000000114",
  csfCohort2028: "10000000-0000-4000-8000-000000000102",
  csfCohort2027: "10000000-0000-4000-8000-000000000115",
  csfCohort2029: "10000000-0000-4000-8000-000000000116",
  csfProfileMember: "10000000-0000-4000-8000-000000000103",
  csfProfileRestricted: "10000000-0000-4000-8000-000000000104",
  csfProfileOfficer: "10000000-0000-4000-8000-000000000117",
  csfProfileComplete: "10000000-0000-4000-8000-000000000118",
  csfProfilePending: "10000000-0000-4000-8000-000000000119",
  csfProfileMissingHours: "10000000-0000-4000-8000-000000000120",
  csfProfileDuplicate: "10000000-0000-4000-8000-000000000121",
  csfSheetSource: "10000000-0000-4000-8000-000000000105",
  csfSheetJobPreview: "10000000-0000-4000-8000-000000000122",
  csfSheetJobCommit: "10000000-0000-4000-8000-000000000123",
  csfOpportunity: "10000000-0000-4000-8000-000000000106",
  csfOpportunityFoodBank: "10000000-0000-4000-8000-000000000124",
  csfOpportunityCleanup: "10000000-0000-4000-8000-000000000125",
  csfOpportunityTutoring: "10000000-0000-4000-8000-000000000126",
  csfOpportunityDrive: "10000000-0000-4000-8000-000000000127",
  csfActivityOpportunity: "10000000-0000-4000-8000-000000000107",
  csfActivityMeeting: "10000000-0000-4000-8000-000000000108",
  csfMeetingGeneral: "10000000-0000-4000-8000-000000000128",
  csfMeetingService: "10000000-0000-4000-8000-000000000129",
  csfRestriction: "10000000-0000-4000-8000-000000000109",
  csfRoleOwner: "10000000-0000-4000-8000-000000000110",
  csfRoleActivityCoordinator: "10000000-0000-4000-8000-000000000111",
  csfRoleCoPresident: "10000000-0000-4000-8000-000000000130",
  csfRoleSecretary: "10000000-0000-4000-8000-000000000131",
  csfRoleAdvisor: "10000000-0000-4000-8000-000000000132",
  csfStaffPosition: "10000000-0000-4000-8000-000000000112",
  csfStaffSecretary: "10000000-0000-4000-8000-000000000133",
  csfPartnerClub: "10000000-0000-4000-8000-000000000113",
  csfPartnerLibrary: "10000000-0000-4000-8000-000000000134",
  csfPartnerBatch: "10000000-0000-4000-8000-000000000135",
  csfAnnouncementPinned: "10000000-0000-4000-8000-000000000136",
  csfAnnouncementOfficer: "10000000-0000-4000-8000-000000000137",
};

const accounts = [
  {
    key: "developer",
    email: "riddhiman.rana@gmail.com",
    fullName: "Riddhiman Rana",
    roles: ["admin", "admin", "admin", "admin"],
  },
  {
    key: "staff",
    email: "platform.staff@local.test",
    fullName: "Platform Staff",
    roles: ["staff", "staff", null, null],
  },
  {
    key: "member",
    email: "platform.member@local.test",
    fullName: "Platform Member",
    roles: ["member", null, "member", null],
  },
  {
    key: "outsider",
    email: "platform.outsider@local.test",
    fullName: "Platform Outsider",
    roles: [null, null, null, null],
  },
  {
    key: "csfOfficer",
    email: "csf.officer@local.test",
    fullName: "CSF Officer",
    roles: [null, null, null, "staff"],
  },
  {
    key: "csfMember",
    email: "student.2028@local.test",
    fullName: "Aarav Mehta",
    roles: [null, null, null, "member"],
  },
];

const pluginKeys = [
  "calendar-tools",
  "community-impact-radar",
  "dvhs-csf",
  "family-liaison-workbench",
];

const pluginCatalogRows = [
  {
    key: "calendar-tools",
    name: "Calendar Tools",
    description:
      "Server-rendered calendar workflow helpers for organization projects.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "community-impact-radar",
    name: "Community Impact Radar",
    description:
      "Organization impact analytics surfaces backed by host-controlled read paths.",
    visibility: "global",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "dvhs-csf",
    name: "DVHS CSF",
    description:
      "Private CSF workflow system for cohort membership, applications, officer roles, points, posts, and sheets.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "family-liaison-workbench",
    name: "Family Liaison Workbench",
    description:
      "Staff-only liaison workflow surfaces for signup and family support pilots.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retrySupabaseAuthRequest(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await operation();
    if (!result.error) return result;

    lastError = result.error;
    const status = result.error.status;
    const retryable =
      status === 502 ||
      status === 503 ||
      status === 504 ||
      status === undefined;
    if (!retryable || attempt === 5) break;
    await sleep(500 * attempt);
  }

  throw new Error(
    `${label} failed: ${lastError?.message ?? "unknown Supabase Auth error"}`,
  );
}

async function upsertAuthUser(admin, account) {
  const { data: listed } = await retrySupabaseAuthRequest(
    "List local auth users",
    () =>
      admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      }),
  );

  const existing = listed.users.find(
    (user) => user.email?.toLowerCase() === account.email,
  );

  const payload = {
    password: "robo6737",
    email_confirm: true,
    user_metadata: {
      full_name: account.fullName,
      username: account.email.split("@")[0].replaceAll(".", "-"),
      has_completed_onboarding: true,
      has_completed_intro_tour: true,
      local_fixture: true,
    },
  };

  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(
      existing.id,
      payload,
    );
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    ...payload,
  });
  if (error) throw error;
  return data.user;
}

async function must(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function main() {
  const { url, serviceRoleKey } = getLocalSupabaseEnv();
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const users = {};
  for (const account of accounts) {
    users[account.key] = await upsertAuthUser(admin, account);
  }

  await must(
    "trusted-member-developer",
    admin.from("trusted_member").upsert(
      {
        id: users.developer.id,
        user_id: users.developer.id,
        name: "Riddhiman Rana",
        email: "riddhiman.rana@gmail.com",
        status: true,
        reason: "Developer admin access",
      },
      { onConflict: "id" },
    ),
  );

  const organizations = [
    {
      id: IDS.primaryOrg,
      name: "Local Platform Org",
      username: "local-platform-org",
      type: "nonprofit",
      description:
        "Default local organization for plugin platform and data-isolation testing.",
      join_code: "LOCAL1",
      created_by: users.developer.id,
    },
    {
      id: IDS.nonprofitOrg,
      name: "Acts of Hearts",
      username: "acts-of-hearts",
      type: "nonprofit",
      description:
        "Local nonprofit fixture for public project and organization workflows.",
      join_code: "AOHLC1",
      created_by: users.developer.id,
    },
    {
      id: IDS.schoolOrg,
      name: "Local School Volunteers",
      username: "local-school-volunteers",
      type: "school",
      description:
        "Local school organization fixture for membership isolation checks.",
      join_code: "SCHOOL",
      created_by: users.developer.id,
    },
    {
      id: IDS.csfOrg,
      name: "DVHS CSF",
      username: "dvhs-csf",
      type: "school",
      description:
        "Deterministic local fixture for the DVHS CSF private plugin.",
      logo_url: "/logos/dvhigh-csf.png",
      show_members_publicly: false,
      join_code: "DVCSF1",
      created_by: users.developer.id,
    },
  ];

  await must(
    "organizations",
    admin.from("organizations").upsert(organizations),
  );

  const orgIds = [IDS.primaryOrg, IDS.nonprofitOrg, IDS.schoolOrg, IDS.csfOrg];
  const membershipRows = [];
  for (const account of accounts) {
    const userId = users[account.key].id;
    for (let orgIdx = 0; orgIdx < orgIds.length; orgIdx += 1) {
      const role = account.roles[orgIdx];
      if (!role) continue;
      membershipRows.push({
        organization_id: orgIds[orgIdx],
        user_id: userId,
        role,
        status: "active",
      });
    }
  }

  await must(
    "organization memberships",
    admin
      .from("organization_members")
      .upsert(membershipRows, { onConflict: "organization_id,user_id" }),
  );

  await must(
    "plugin catalog",
    admin.from("plugins").upsert(pluginCatalogRows, {
      onConflict: "key",
    }),
  );

  for (const pluginKey of pluginKeys) {
    const entitledOrgIds =
      pluginKey === "dvhs-csf"
        ? [IDS.csfOrg]
        : orgIds.filter((orgId) => orgId !== IDS.csfOrg);
    for (const orgId of entitledOrgIds) {
      await must(
        `entitlement-${pluginKey}-${orgId}`,
        admin.from("organization_plugin_entitlements").upsert(
          {
            organization_id: orgId,
            plugin_key: pluginKey,
            status: "active",
            is_forced: false,
            created_by: users.developer.id,
          },
          { onConflict: "organization_id,plugin_key" },
        ),
      );

      await must(
        `install-${pluginKey}-${orgId}`,
        admin.from("organization_plugin_installs").upsert(
          {
            organization_id: orgId,
            plugin_key: pluginKey,
            enabled: true,
            installed_version: "0.1.0",
            installed_by: users.developer.id,
            configuration: {
              localFixture: true,
              serverOnlyDataAccess: true,
            },
          },
          { onConflict: "organization_id,plugin_key" },
        ),
      );
    }
  }

  const pluginDb = admin.schema("plugin_data");
  const csfTablesToReset = [
    "csf_admin_audit_events",
    "csf_profile_activity_events",
    "csf_profile_merge_reviews",
    "csf_profile_link_requests",
    "csf_sheet_sync_logs",
    "csf_sheet_import_rows",
    "csf_sheet_import_jobs",
    "csf_partner_submission_rows",
    "csf_partner_submission_batches",
    "csf_partner_clubs",
    "csf_onboarding_links",
    "csf_sheet_sources",
    "csf_meeting_attendance",
    "csf_term_meetings",
    "csf_submission_reviews",
    "csf_credit_records",
    "csf_submission_files",
    "csf_point_submissions",
    "csf_term_point_rules",
    "csf_point_categories",
    "csf_opportunity_signups",
    "csf_opportunities",
    "csf_announcements",
    "csf_profile_restrictions",
    "csf_staff_position_history",
    "csf_staff_positions",
    "csf_role_permissions",
    "csf_roles",
    "csf_application_status_events",
    "csf_application_files",
    "csf_application_course_entries",
    "csf_term_applications",
    "csf_profile_cohort_memberships",
    "csf_profile_accounts",
    "csf_profiles",
    "csf_cohort_terms",
    "csf_cohorts",
    "csf_terms",
  ];

  for (const table of csfTablesToReset) {
    await must(
      `csf-reset-${table}`,
      pluginDb.from(table).delete().eq("organization_id", IDS.csfOrg),
    );
  }

  await must(
    "csf-roles",
    pluginDb.from("csf_roles").upsert(
      [
        {
          id: IDS.csfRoleOwner,
          organization_id: IDS.csfOrg,
          key: "owner",
          display_name: "CSF Owner",
          description: "Root CSF plugin owner identity.",
          role_type: "owner",
          is_system: true,
          sort_order: 0,
        },
        {
          id: IDS.csfRoleActivityCoordinator,
          organization_id: IDS.csfOrg,
          key: "activity-coordinator",
          display_name: "Activity Coordinator",
          description: "Creates CSF posts and verifies participation.",
          role_type: "officer_template",
          is_system: true,
          sort_order: 60,
        },
      ],
      { onConflict: "organization_id,key" },
    ),
  );

  await must(
    "csf-role-permissions",
    pluginDb.from("csf_role_permissions").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          role_id: IDS.csfRoleOwner,
          permission_key: "manage_settings",
          enabled: true,
        },
        {
          organization_id: IDS.csfOrg,
          role_id: IDS.csfRoleActivityCoordinator,
          permission_key: "manage_opportunities",
          enabled: true,
        },
        {
          organization_id: IDS.csfOrg,
          role_id: IDS.csfRoleActivityCoordinator,
          permission_key: "verify_submissions",
          enabled: true,
        },
        {
          organization_id: IDS.csfOrg,
          role_id: IDS.csfRoleActivityCoordinator,
          permission_key: "manage_partner_clubs",
          enabled: true,
        },
      ],
      { onConflict: "role_id,permission_key" },
    ),
  );

  await must(
    "csf-staff-position",
    pluginDb.from("csf_staff_positions").upsert({
      id: IDS.csfStaffPosition,
      organization_id: IDS.csfOrg,
      user_id: users.csfOfficer.id,
      role_id: IDS.csfRoleActivityCoordinator,
      school_year: "2025-2026",
      display_title: "Activity Coordinator",
      status: "active",
      appointed_by: users.developer.id,
      notes: "Local fixture officer.",
    }),
  );

  await must(
    "csf-clear-current-terms",
    pluginDb
      .from("csf_terms")
      .update({ is_current: false })
      .eq("organization_id", IDS.csfOrg),
  );

  await must(
    "csf-term-s26",
    pluginDb.from("csf_terms").upsert(
      {
        id: IDS.csfTermS26,
        organization_id: IDS.csfOrg,
        code: "S26",
        label: "Spring 2026",
        school_year: "2025-2026",
        semester: "spring",
        is_current: true,
      },
      { onConflict: "organization_id,code" },
    ),
  );

  await must(
    "csf-cohort-2028",
    pluginDb.from("csf_cohorts").upsert(
      {
        id: IDS.csfCohort2028,
        organization_id: IDS.csfOrg,
        graduation_year: 2028,
        label: "Class of 2028",
        status: "active",
      },
      { onConflict: "organization_id,graduation_year" },
    ),
  );

  await must(
    "csf-cohort-term",
    pluginDb.from("csf_cohort_terms").upsert(
      {
        organization_id: IDS.csfOrg,
        cohort_id: IDS.csfCohort2028,
        term_id: IDS.csfTermS26,
        grade_level: 10,
        sheet_tab_name: "S26",
      },
      { onConflict: "cohort_id,term_id" },
    ),
  );

  await must(
    "csf-profiles",
    pluginDb.from("csf_profiles").upsert([
      {
        id: IDS.csfProfileMember,
        organization_id: IDS.csfOrg,
        first_name: "Aarav",
        last_name: "Mehta",
        preferred_name: "Aarav",
        school_email: "aarav.mehta28@students.local.test",
        personal_email: "student.2028@local.test",
        normalized_first_name: "aarav",
        normalized_last_name: "mehta",
        normalized_school_email: "aarav.mehta28@students.local.test",
        normalized_personal_email: "student.2028@local.test",
        source_summary: { localFixture: true },
      },
      {
        id: IDS.csfProfileRestricted,
        organization_id: IDS.csfOrg,
        first_name: "Nina",
        last_name: "Kapoor",
        school_email: "nina.kapoor28@students.local.test",
        normalized_first_name: "nina",
        normalized_last_name: "kapoor",
        normalized_school_email: "nina.kapoor28@students.local.test",
        source_summary: { localFixture: true },
      },
    ]),
  );

  await must(
    "csf-profile-memberships",
    pluginDb.from("csf_profile_cohort_memberships").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMember,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileRestricted,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
      ],
      { onConflict: "profile_id,cohort_id" },
    ),
  );

  await must(
    "csf-profile-account",
    pluginDb.from("csf_profile_accounts").upsert(
      {
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMember,
        user_id: users.csfMember.id,
        status: "verified",
        is_primary: true,
        linked_by: users.developer.id,
      },
      { onConflict: "organization_id,profile_id,user_id" },
    ),
  );

  await must(
    "csf-point-rules",
    pluginDb.from("csf_term_point_rules").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          term_id: IDS.csfTermS26,
          point_type: "drive",
          label: "Drive points",
          min_required: 0,
          max_counted: 2,
          is_required: false,
          display_order: 10,
        },
        {
          organization_id: IDS.csfOrg,
          term_id: IDS.csfTermS26,
          point_type: "non_drive",
          label: "Non-drive points",
          min_required: 5,
          max_counted: 5,
          is_required: true,
          display_order: 20,
        },
      ],
      { onConflict: "organization_id,term_id,point_type" },
    ),
  );

  await must(
    "csf-sheet-source",
    pluginDb.from("csf_sheet_sources").upsert(
      {
        id: IDS.csfSheetSource,
        organization_id: IDS.csfOrg,
        cohort_id: IDS.csfCohort2028,
        title: "Class of 2028 workbook",
        provider: "google_sheets",
        spreadsheet_id: "local-csf-sheet-fixture",
        sheet_url:
          "https://docs.google.com/spreadsheets/d/local-csf-sheet-fixture",
        sync_owner_user_id: users.developer.id,
        sync_mode: "manual",
        sync_status: "needs_attention",
        last_sync_status: "preview_completed",
        last_sync_error: "2 rows need officer review before commit.",
        last_previewed_at: "2026-03-18T18:10:00-07:00",
        last_committed_at: "2026-03-17T17:30:00-07:00",
        last_synced_at: "2026-03-17T17:30:00-07:00",
        duplicate_policy: "match_email_then_name",
        column_mappings: {
          firstName: "First",
          lastName: "Last",
          schoolEmail: "SRVUSD Email",
          personalEmail: "Most Checked Email",
          activities: "Activity 1..7",
          meetings: "Meeting*",
          requirementsMet: "All Reqs Met?",
        },
        tab_mappings: [
          {
            cohortYear: 2028,
            termCode: "S26",
            tabName: "S26",
            rangeA1: "A1:Z1000",
          },
        ],
      },
      { onConflict: "organization_id,cohort_id,title" },
    ),
  );

  await must(
    "csf-onboarding-link",
    pluginDb.from("csf_onboarding_links").upsert(
      {
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        cohort_id: IDS.csfCohort2028,
        sheet_source_id: IDS.csfSheetSource,
        code: "S26-2028",
        title: "Spring 2026 Class of 2028",
        link_type: "combined",
        google_form_url:
          "https://docs.google.com/forms/d/local-csf-form-fixture/viewform",
        landing_message:
          "Connect your Let’s Assist profile, then complete the official CSF Google Form.",
        is_active: true,
        created_by: users.developer.id,
      },
      { onConflict: "organization_id,code" },
    ),
  );

  await must(
    "csf-opportunity",
    pluginDb.from("csf_opportunities").upsert({
      id: IDS.csfOpportunity,
      organization_id: IDS.csfOrg,
      term_id: IDS.csfTermS26,
      title: "Quail Run Suessical Musical",
      body: "Quail Run is hosting their Suessical Musical and has volunteer slots open.",
      starts_at: "2026-05-08T17:15:00-07:00",
      ends_at: "2026-05-08T19:15:00-07:00",
      location: "Quail Run Elementary School",
      signup_url:
        "https://docs.google.com/spreadsheets/d/local-quail-run-signup/edit",
      contact_email: "sandralei@gmail.com",
      point_value: 2,
      point_type: "non_drive",
      signup_mode: "external",
      requires_point_submission: true,
      evidence_policy: "optional",
      source_organization: "Quail Run Elementary School",
      created_by_user_id: users.csfOfficer.id,
      status: "published",
      external_sheet_url:
        "https://docs.google.com/spreadsheets/d/local-quail-run-signup/edit",
      sheet_export_status: "not_exported",
      published_at: "2026-05-07T12:00:00-07:00",
    }),
  );

  await must(
    "csf-partner-club",
    pluginDb.from("csf_partner_clubs").upsert(
      {
        id: IDS.csfPartnerClub,
        organization_id: IDS.csfOrg,
        name: "Quail Run Elementary School",
        contact_name: "Sandra Lei",
        contact_email: "sandralei@gmail.com",
        approved_point_types: ["non_drive"],
        notes: "Fixture partner source for imported participant sheets.",
        status: "active",
        created_by: users.csfOfficer.id,
      },
      { onConflict: "organization_id,name" },
    ),
  );

  await must(
    "csf-activity-events",
    pluginDb.from("csf_profile_activity_events").upsert([
      {
        id: IDS.csfActivityOpportunity,
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMember,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunity,
        event_type: "opportunity",
        title: "Quail Run Suessical Musical",
        description: "Imported local fixture credit.",
        event_at: "2026-05-08T19:15:00-07:00",
        point_type: "non_drive",
        raw_points: 2,
        counted_points: 2,
        status: "verified",
        source: "manual",
        source_ref: { localFixture: true },
      },
      {
        id: IDS.csfActivityMeeting,
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMember,
        term_id: IDS.csfTermS26,
        event_type: "meeting",
        title: "Spring General Meeting",
        event_at: "2026-02-03T15:45:00-08:00",
        point_type: "meeting",
        raw_points: 1,
        counted_points: 1,
        status: "verified",
        source: "legacy_import",
        source_ref: { localFixture: true },
      },
    ]),
  );

  await must(
    "csf-restriction",
    pluginDb.from("csf_profile_restrictions").upsert({
      id: IDS.csfRestriction,
      organization_id: IDS.csfOrg,
      profile_id: IDS.csfProfileRestricted,
      scope: "manual_review_required",
      status: "active",
      reason_category: "local_fixture",
      private_notes:
        "Fixture profile used to verify staff-only restriction handling.",
      visible_message: "Your CSF profile needs staff review.",
      created_by: users.developer.id,
    }),
  );

  const csfPermissionKeys = [
    "manage_roles",
    "manage_cohorts_terms",
    "manage_profiles",
    "review_applications",
    "manage_restrictions",
    "manage_opportunities",
    "manage_partner_clubs",
    "process_points",
    "verify_submissions",
    "edit_point_rules",
    "manage_payment_review",
    "manage_calendar_sync",
    "manage_sheet_sync",
    "manage_settings",
    "export_reports",
    "export_sensitive_reports",
    "edit_public_content",
    "view_audit_history",
  ];

  const seededRoles = [
    {
      id: IDS.csfRoleOwner,
      key: "owner",
      display_name: "CSF Owner",
      description: "Root CSF plugin owner identity.",
      role_type: "owner",
      sort_order: 0,
      permissions: csfPermissionKeys,
    },
    {
      id: IDS.csfRoleCoPresident,
      key: "co-president",
      display_name: "Co-President",
      description:
        "Full CSF officer admin for roster, points, posts, and reports.",
      role_type: "officer_template",
      sort_order: 10,
      permissions: csfPermissionKeys.filter(
        (permission) => permission !== "manage_roles",
      ),
    },
    {
      id: IDS.csfRoleSecretary,
      key: "secretary",
      display_name: "Secretary",
      description:
        "Roster, application, meeting attendance, and report operations.",
      role_type: "officer_template",
      sort_order: 40,
      permissions: [
        "manage_cohorts_terms",
        "manage_profiles",
        "review_applications",
        "process_points",
        "verify_submissions",
        "manage_sheet_sync",
        "export_reports",
        "view_audit_history",
      ],
    },
    {
      id: IDS.csfRoleActivityCoordinator,
      key: "activity-coordinator",
      display_name: "Activity Coordinator",
      description: "Creates CSF posts and verifies participation.",
      role_type: "officer_template",
      sort_order: 60,
      permissions: [
        "manage_opportunities",
        "manage_partner_clubs",
        "process_points",
        "verify_submissions",
        "manage_calendar_sync",
        "view_audit_history",
      ],
    },
    {
      id: IDS.csfRoleAdvisor,
      key: "advisor",
      display_name: "Advisor",
      description:
        "Adult advisor oversight for sensitive review, exports, and restrictions.",
      role_type: "officer_template",
      sort_order: 70,
      permissions: csfPermissionKeys,
    },
  ];

  await must(
    "csf-expanded-roles",
    pluginDb.from("csf_roles").upsert(
      seededRoles.map(({ permissions: _permissions, ...role }) => ({
        ...role,
        organization_id: IDS.csfOrg,
        is_system: true,
      })),
      { onConflict: "organization_id,key" },
    ),
  );

  await must(
    "csf-expanded-role-permissions",
    pluginDb.from("csf_role_permissions").upsert(
      seededRoles.flatMap((role) =>
        role.permissions.map((permission) => ({
          organization_id: IDS.csfOrg,
          role_id: role.id,
          permission_key: permission,
          enabled: true,
        })),
      ),
      { onConflict: "role_id,permission_key" },
    ),
  );

  await must(
    "csf-expanded-terms",
    pluginDb.from("csf_terms").upsert(
      [
        {
          id: IDS.csfTermF25,
          organization_id: IDS.csfOrg,
          code: "F25",
          label: "Fall 2025",
          school_year: "2025-2026",
          semester: "fall",
          starts_at: "2025-08-12",
          ends_at: "2025-12-19",
          is_current: false,
          settings: {
            csfPointPolicy: { minimumTotalPoints: 7, maxDrivePoints: 2 },
          },
        },
        {
          id: IDS.csfTermS26,
          organization_id: IDS.csfOrg,
          code: "S26",
          label: "Spring 2026",
          school_year: "2025-2026",
          semester: "spring",
          starts_at: "2026-01-06",
          ends_at: "2026-05-29",
          is_current: true,
          settings: {
            csfPointPolicy: { minimumTotalPoints: 7, maxDrivePoints: 2 },
          },
        },
      ],
      { onConflict: "organization_id,code" },
    ),
  );

  await must(
    "csf-expanded-cohorts",
    pluginDb.from("csf_cohorts").upsert(
      [
        {
          id: IDS.csfCohort2027,
          organization_id: IDS.csfOrg,
          graduation_year: 2027,
          label: "Class of 2027",
          status: "active",
        },
        {
          id: IDS.csfCohort2028,
          organization_id: IDS.csfOrg,
          graduation_year: 2028,
          label: "Class of 2028",
          status: "active",
        },
        {
          id: IDS.csfCohort2029,
          organization_id: IDS.csfOrg,
          graduation_year: 2029,
          label: "Class of 2029",
          status: "active",
        },
      ],
      { onConflict: "organization_id,graduation_year" },
    ),
  );

  await must(
    "csf-expanded-cohort-terms",
    pluginDb.from("csf_cohort_terms").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          cohort_id: IDS.csfCohort2027,
          term_id: IDS.csfTermF25,
          grade_level: 11,
          sheet_tab_name: "F25-2027",
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          cohort_id: IDS.csfCohort2027,
          term_id: IDS.csfTermS26,
          grade_level: 11,
          sheet_tab_name: "S26-2027",
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          cohort_id: IDS.csfCohort2028,
          term_id: IDS.csfTermF25,
          grade_level: 10,
          sheet_tab_name: "F25-2028",
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          cohort_id: IDS.csfCohort2029,
          term_id: IDS.csfTermS26,
          grade_level: 9,
          sheet_tab_name: "S26-2029",
          status: "active",
        },
      ],
      { onConflict: "cohort_id,term_id" },
    ),
  );

  await must(
    "csf-expanded-profiles",
    pluginDb.from("csf_profiles").upsert([
      {
        id: IDS.csfProfileOfficer,
        organization_id: IDS.csfOrg,
        first_name: "Priya",
        last_name: "Shah",
        preferred_name: "Priya",
        school_email: "priya.shah27@students.local.test",
        personal_email: "csf.officer@local.test",
        normalized_first_name: "priya",
        normalized_last_name: "shah",
        normalized_school_email: "priya.shah27@students.local.test",
        normalized_personal_email: "csf.officer@local.test",
        source_summary: { localFixture: true, role: "officer" },
      },
      {
        id: IDS.csfProfileComplete,
        organization_id: IDS.csfOrg,
        first_name: "Maya",
        last_name: "Patel",
        preferred_name: "Maya",
        school_email: "maya.patel28@students.local.test",
        personal_email: "maya.patel@example.test",
        normalized_first_name: "maya",
        normalized_last_name: "patel",
        normalized_school_email: "maya.patel28@students.local.test",
        normalized_personal_email: "maya.patel@example.test",
        source_summary: { localFixture: true, status: "requirements_complete" },
      },
      {
        id: IDS.csfProfilePending,
        organization_id: IDS.csfOrg,
        first_name: "Evan",
        last_name: "Chen",
        preferred_name: "Evan",
        school_email: "evan.chen28@students.local.test",
        personal_email: "evan.chen@example.test",
        normalized_first_name: "evan",
        normalized_last_name: "chen",
        normalized_school_email: "evan.chen28@students.local.test",
        normalized_personal_email: "evan.chen@example.test",
        source_summary: { localFixture: true, status: "pending_hours" },
      },
      {
        id: IDS.csfProfileMissingHours,
        organization_id: IDS.csfOrg,
        first_name: "Sofia",
        last_name: "Nguyen",
        preferred_name: "Sofia",
        school_email: "sofia.nguyen29@students.local.test",
        personal_email: "sofia.nguyen@example.test",
        normalized_first_name: "sofia",
        normalized_last_name: "nguyen",
        normalized_school_email: "sofia.nguyen29@students.local.test",
        normalized_personal_email: "sofia.nguyen@example.test",
        source_summary: { localFixture: true, status: "missing_hours" },
      },
      {
        id: IDS.csfProfileDuplicate,
        organization_id: IDS.csfOrg,
        first_name: "Maya",
        last_name: "Patel",
        preferred_name: "Maya P.",
        school_email: "maya.patel.alt@students.local.test",
        normalized_first_name: "maya",
        normalized_last_name: "patel",
        normalized_school_email: "maya.patel.alt@students.local.test",
        source_summary: { localFixture: true, status: "duplicate_review" },
      },
    ]),
  );

  await must(
    "csf-expanded-profile-memberships",
    pluginDb.from("csf_profile_cohort_memberships").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileOfficer,
          cohort_id: IDS.csfCohort2027,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileComplete,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfilePending,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMissingHours,
          cohort_id: IDS.csfCohort2029,
          status: "active",
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileDuplicate,
          cohort_id: IDS.csfCohort2028,
          status: "active",
        },
      ],
      { onConflict: "profile_id,cohort_id" },
    ),
  );

  await must(
    "csf-expanded-profile-accounts",
    pluginDb.from("csf_profile_accounts").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileOfficer,
          user_id: users.csfOfficer.id,
          status: "verified",
          is_primary: true,
          linked_by: users.developer.id,
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfilePending,
          user_id: users.member.id,
          status: "pending",
          is_primary: false,
          linked_by: users.developer.id,
          notes: "Fixture pending account link for officer review.",
        },
      ],
      { onConflict: "organization_id,profile_id,user_id" },
    ),
  );

  await must(
    "csf-expanded-staff",
    pluginDb.from("csf_staff_positions").upsert([
      {
        id: IDS.csfStaffPosition,
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileOfficer,
        user_id: users.csfOfficer.id,
        role_id: IDS.csfRoleActivityCoordinator,
        school_year: "2025-2026",
        display_title: "Activity Coordinator",
        status: "active",
        appointed_by: users.developer.id,
        notes: "Owns event rosters and point verification.",
      },
      {
        id: IDS.csfStaffSecretary,
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        role_id: IDS.csfRoleSecretary,
        school_year: "2025-2026",
        display_title: "Secretary",
        status: "active",
        appointed_by: users.developer.id,
        notes: "Maintains class workbooks and meeting attendance.",
      },
    ]),
  );

  await must(
    "csf-expanded-applications",
    pluginDb.from("csf_term_applications").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMember,
          cohort_id: IDS.csfCohort2028,
          term_id: IDS.csfTermS26,
          source: "google_form_sheet",
          status: "accepted",
          current_grade_level: 10,
          returning_status: "returning",
          shirt_size: "returning_member",
          most_checked_email: "student.2028@local.test",
          list_i_points: 5,
          list_i_ii_points: 3,
          grand_total_points: 8,
          social_confirmation: true,
          submitted_at: "2026-01-10T19:30:00-08:00",
          reviewed_by: users.csfOfficer.id,
          reviewed_at: "2026-01-12T16:30:00-08:00",
          review_notes: "Accepted from Spring Google Form import.",
          application_data: { payment: "confirmed", sourceSheet: "S26" },
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileComplete,
          cohort_id: IDS.csfCohort2028,
          term_id: IDS.csfTermS26,
          source: "google_form_sheet",
          status: "accepted",
          current_grade_level: 10,
          returning_status: "new",
          shirt_size: "M",
          most_checked_email: "maya.patel@example.test",
          list_i_points: 6,
          list_i_ii_points: 2,
          grand_total_points: 8,
          social_confirmation: true,
          submitted_at: "2026-01-11T18:05:00-08:00",
          reviewed_by: users.csfOfficer.id,
          reviewed_at: "2026-01-13T15:45:00-08:00",
          review_notes: "Transcript and payment verified.",
          application_data: { payment: "confirmed", transcript: "verified" },
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfilePending,
          cohort_id: IDS.csfCohort2028,
          term_id: IDS.csfTermS26,
          source: "sheet",
          status: "needs_review",
          current_grade_level: 10,
          returning_status: "returning",
          shirt_size: "returning_member",
          most_checked_email: "evan.chen@example.test",
          list_i_points: 4,
          list_i_ii_points: 1,
          grand_total_points: 5,
          submitted_at: "2026-01-12T20:40:00-08:00",
          review_notes: "Missing one List I course row.",
          application_data: { issue: "course_points_low" },
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMissingHours,
          cohort_id: IDS.csfCohort2029,
          term_id: IDS.csfTermS26,
          source: "google_form_sheet",
          status: "needs_action",
          current_grade_level: 9,
          returning_status: "new",
          shirt_size: "S",
          most_checked_email: "sofia.nguyen@example.test",
          list_i_points: 7,
          list_i_ii_points: 0,
          grand_total_points: 7,
          submitted_at: "2026-01-15T21:10:00-08:00",
          review_notes: "Needs student profile link and point plan.",
          application_data: { needsProfileLink: true },
        },
      ],
      { onConflict: "profile_id,term_id" },
    ),
  );

  await must(
    "csf-expanded-meetings",
    pluginDb.from("csf_term_meetings").upsert(
      [
        {
          id: IDS.csfMeetingGeneral,
          organization_id: IDS.csfOrg,
          term_id: IDS.csfTermS26,
          meeting_key: "spring_general_meeting",
          label: "Spring General Meeting",
          meeting_date: "2026-02-03",
          starts_at: "2026-02-03T15:45:00-08:00",
          location: "DVHS Library",
          attendance_source_url:
            "https://docs.google.com/spreadsheets/d/local-csf-meeting-general",
          required: true,
          sort_order: 10,
          status: "active",
          settings: { expectedRows: 180 },
          created_by: users.csfOfficer.id,
        },
        {
          id: IDS.csfMeetingService,
          organization_id: IDS.csfOrg,
          term_id: IDS.csfTermS26,
          meeting_key: "service_check_in",
          label: "Service Check-in",
          meeting_date: "2026-03-10",
          starts_at: "2026-03-10T15:45:00-07:00",
          location: "DVHS Commons",
          attendance_source_url:
            "https://docs.google.com/spreadsheets/d/local-csf-meeting-service",
          required: true,
          sort_order: 20,
          status: "active",
          settings: { expectedRows: 160 },
          created_by: users.csfOfficer.id,
        },
      ],
      { onConflict: "organization_id,term_id,meeting_key" },
    ),
  );

  await must(
    "csf-expanded-opportunities",
    pluginDb.from("csf_opportunities").upsert([
      {
        id: IDS.csfOpportunityFoodBank,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Contra Costa Food Bank Sorting",
        body: "<p>Sort pantry items and assemble grocery boxes for weekend distribution. Wear closed-toe shoes and bring your CSF ID.</p>",
        starts_at: "2026-03-21T09:00:00-07:00",
        ends_at: "2026-03-21T12:00:00-07:00",
        location: "Contra Costa Food Bank Warehouse",
        signup_url:
          "https://docs.google.com/spreadsheets/d/local-food-bank-signup/edit",
        contact_email: "dvhighcsf@gmail.com",
        point_value: 3,
        point_type: "non_drive",
        signup_mode: "external",
        requires_point_submission: true,
        evidence_policy: "optional",
        source_organization: "Contra Costa Food Bank",
        created_by_user_id: users.csfOfficer.id,
        status: "published",
        external_sheet_url:
          "https://docs.google.com/spreadsheets/d/local-food-bank-signup/edit",
        sheet_export_status: "exported",
        sheet_export_row_id: "FoodBank!A42",
        published_at: "2026-03-02T12:00:00-08:00",
      },
      {
        id: IDS.csfOpportunityCleanup,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "DVHS Campus Cleanup",
        body: "<p>Officer-led campus cleanup after school. Gloves and bags will be provided at the Commons.</p>",
        starts_at: "2026-08-28T15:45:00-07:00",
        ends_at: "2026-08-28T17:15:00-07:00",
        location: "DVHS Commons",
        signup_url:
          "https://docs.google.com/spreadsheets/d/local-campus-cleanup/edit",
        contact_email: "dvhighcsf@gmail.com",
        point_value: 1.5,
        point_type: "non_drive",
        signup_mode: "external",
        requires_point_submission: false,
        evidence_policy: "none",
        source_organization: "DVHS CSF",
        created_by_user_id: users.csfOfficer.id,
        status: "published",
        external_sheet_url:
          "https://docs.google.com/spreadsheets/d/local-campus-cleanup/edit",
        sheet_export_status: "pending",
        published_at: "2026-07-01T12:00:00-07:00",
      },
      {
        id: IDS.csfOpportunityTutoring,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Library Peer Tutoring",
        body: "<p>Support Algebra II and chemistry tutoring tables in the library. Members can claim one non-drive point per verified session.</p>",
        starts_at: "2026-09-02T15:30:00-07:00",
        ends_at: "2026-09-02T16:30:00-07:00",
        location: "DVHS Library",
        signup_url:
          "https://docs.google.com/spreadsheets/d/local-library-tutoring/edit",
        contact_email: "dvhs.library@example.test",
        point_value: 1,
        point_type: "non_drive",
        signup_mode: "external",
        requires_point_submission: true,
        evidence_policy: "required",
        source_organization: "DVHS Library",
        created_by_user_id: users.csfOfficer.id,
        status: "published",
        external_sheet_url:
          "https://docs.google.com/spreadsheets/d/local-library-tutoring/edit",
        sheet_export_status: "not_exported",
        published_at: "2026-07-03T09:00:00-07:00",
      },
      {
        id: IDS.csfOpportunityDrive,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Hygiene Kit Drive",
        body: "<p>Bring approved hygiene-kit supplies for a local shelter partner. Drive points are capped by CSF policy.</p>",
        starts_at: "2026-09-14T08:00:00-07:00",
        ends_at: "2026-09-18T15:30:00-07:00",
        location: "DVHS Front Office",
        contact_email: "dvhighcsf@gmail.com",
        point_value: 2,
        point_type: "drive",
        signup_mode: "none",
        requires_point_submission: true,
        evidence_policy: "required",
        source_organization: "DVHS CSF",
        created_by_user_id: users.csfOfficer.id,
        status: "published",
        sheet_export_status: "not_exported",
        published_at: "2026-07-01T11:00:00-07:00",
      },
    ]),
  );

  await must(
    "csf-expanded-signups",
    pluginDb.from("csf_opportunity_signups").upsert(
      [
        {
          id: "10000000-0000-4000-8000-000000000201",
          organization_id: IDS.csfOrg,
          opportunity_id: IDS.csfOpportunityFoodBank,
          profile_id: IDS.csfProfileComplete,
          term_id: IDS.csfTermS26,
          source: "external_sheet",
          signup_status: "credited",
          attendance_status: "verified",
          signup_name: "Maya Patel",
          signup_email: "maya.patel28@students.local.test",
          external_row_id: "FoodBank!12",
          signed_up_at: "2026-03-04T18:32:00-08:00",
          attendance_verified_by: users.csfOfficer.id,
          attendance_verified_at: "2026-03-21T13:20:00-07:00",
          points_expected: 3,
          metadata: { slot: "9am sorting", localFixture: true },
        },
        {
          id: "10000000-0000-4000-8000-000000000202",
          organization_id: IDS.csfOrg,
          opportunity_id: IDS.csfOpportunityFoodBank,
          profile_id: IDS.csfProfilePending,
          term_id: IDS.csfTermS26,
          source: "external_sheet",
          signup_status: "signed_up",
          attendance_status: "unknown",
          signup_name: "Evan Chen",
          signup_email: "evan.chen28@students.local.test",
          external_row_id: "FoodBank!18",
          signed_up_at: "2026-03-05T16:12:00-08:00",
          points_expected: 3,
          metadata: { slot: "9am sorting", localFixture: true },
        },
        {
          id: "10000000-0000-4000-8000-000000000203",
          organization_id: IDS.csfOrg,
          opportunity_id: IDS.csfOpportunityCleanup,
          profile_id: IDS.csfProfileMissingHours,
          term_id: IDS.csfTermS26,
          source: "external_sheet",
          signup_status: "waitlisted",
          attendance_status: "unknown",
        signup_name: "Sofia Nguyen",
        signup_email: "sofia.nguyen29@students.local.test",
        external_row_id: "Cleanup!27",
        signed_up_at: "2026-07-04T20:05:00-07:00",
          points_expected: 1.5,
          metadata: { waitlistPosition: 3, localFixture: true },
        },
      ],
      { onConflict: "organization_id,opportunity_id,profile_id" },
    ),
  );

  await must(
    "csf-expanded-submissions",
    pluginDb.from("csf_point_submissions").upsert([
      {
        id: "10000000-0000-4000-8000-000000000204",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfilePending,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityFoodBank,
        source: "student",
        description: "Food bank sorting shift",
        claimed_points: 3,
        point_type: "non_drive",
        status: "submitted",
        submitted_by: users.member.id,
        submitted_at: "2026-03-21T20:10:00-07:00",
      },
      {
        id: "10000000-0000-4000-8000-000000000205",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMissingHours,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityDrive,
        source: "student",
        description: "Hygiene kit donation receipt",
        claimed_points: 2,
        point_type: "drive",
        status: "needs_action",
        submitted_at: "2026-04-09T19:45:00-07:00",
        review_notes: "Photo evidence is missing item count.",
      },
      {
        id: "10000000-0000-4000-8000-000000000206",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityFoodBank,
        source: "student",
        description: "Food bank sorting verified by officer roster",
        claimed_points: 3,
        point_type: "non_drive",
        status: "approved",
        submitted_at: "2026-03-21T12:35:00-07:00",
        reviewed_by: users.csfOfficer.id,
        reviewed_at: "2026-03-21T13:25:00-07:00",
        review_notes: "Matched attendance sheet.",
      },
    ]),
  );

  await must(
    "csf-expanded-credit-records",
    pluginDb.from("csf_credit_records").upsert([
      {
        id: "10000000-0000-4000-8000-000000000207",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        submission_id: "10000000-0000-4000-8000-000000000206",
        opportunity_id: IDS.csfOpportunityFoodBank,
        source: "submission",
        points: 3,
        point_type: "non_drive",
        status: "verified",
        verified_by: users.csfOfficer.id,
        verified_at: "2026-03-21T13:25:00-07:00",
        evidence: { rosterRow: "FoodBank!12" },
      },
      {
        id: "10000000-0000-4000-8000-000000000208",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        source: "manual",
        points: 2,
        point_type: "drive",
        status: "verified",
        verified_by: users.csfOfficer.id,
        verified_at: "2026-04-12T16:20:00-07:00",
        evidence: { drive: "Hygiene Kit Drive" },
      },
      {
        id: "10000000-0000-4000-8000-000000000209",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfilePending,
        term_id: IDS.csfTermS26,
        submission_id: "10000000-0000-4000-8000-000000000204",
        opportunity_id: IDS.csfOpportunityFoodBank,
        source: "submission",
        points: 3,
        point_type: "non_drive",
        status: "pending",
        evidence: { rosterRow: "FoodBank!18" },
      },
      {
        id: "10000000-0000-4000-8000-000000000210",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileMember,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunity,
        source: "manual",
        points: 2,
        point_type: "non_drive",
        status: "verified",
        verified_by: users.csfOfficer.id,
        verified_at: "2026-05-08T19:20:00-07:00",
        evidence: { localFixture: true },
      },
    ]),
  );

  await must(
    "csf-expanded-meeting-attendance",
    pluginDb.from("csf_meeting_attendance").upsert(
      [
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMember,
          term_id: IDS.csfTermS26,
          term_meeting_id: IDS.csfMeetingGeneral,
          meeting_key: "spring_general_meeting",
          meeting_label: "Spring General Meeting",
          status: "attended",
          source: "sheet",
          submitted_name: "Aarav Mehta",
          submitted_email: "aarav.mehta28@students.local.test",
          match_status: "confirmed",
          match_confidence: 1,
          match_details: { matchBasis: "email" },
          source_submitted_at: "2026-02-03T15:51:00-08:00",
          recorded_by: users.csfOfficer.id,
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileComplete,
          term_id: IDS.csfTermS26,
          term_meeting_id: IDS.csfMeetingGeneral,
          meeting_key: "spring_general_meeting",
          meeting_label: "Spring General Meeting",
          status: "attended",
          source: "sheet",
          submitted_name: "Maya Patel",
          submitted_email: "maya.patel28@students.local.test",
          match_status: "confirmed",
          match_confidence: 1,
          match_details: { matchBasis: "email" },
          source_submitted_at: "2026-02-03T15:52:00-08:00",
          recorded_by: users.csfOfficer.id,
        },
        {
          organization_id: IDS.csfOrg,
          profile_id: IDS.csfProfileMissingHours,
          term_id: IDS.csfTermS26,
          term_meeting_id: IDS.csfMeetingService,
          meeting_key: "service_check_in",
          meeting_label: "Service Check-in",
          status: "missed",
          source: "sheet",
          submitted_name: "Sofia Nguyen",
          submitted_email: "sofia.nguyen29@students.local.test",
          match_status: "confirmed",
          match_confidence: 1,
          match_details: { matchBasis: "email" },
          recorded_by: users.csfOfficer.id,
        },
      ],
      { onConflict: "profile_id,term_id,meeting_key" },
    ),
  );

  await must(
    "csf-expanded-activity-events",
    pluginDb.from("csf_profile_activity_events").upsert([
      {
        id: "10000000-0000-4000-8000-000000000211",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityFoodBank,
        credit_record_id: "10000000-0000-4000-8000-000000000207",
        event_type: "opportunity",
        title: "Contra Costa Food Bank Sorting",
        description: "Verified from imported sign-up roster.",
        event_at: "2026-03-21T12:00:00-07:00",
        point_type: "non_drive",
        raw_points: 3,
        counted_points: 3,
        status: "verified",
        source: "submission",
        source_ref: { signupId: "10000000-0000-4000-8000-000000000201" },
      },
      {
        id: "10000000-0000-4000-8000-000000000212",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfileComplete,
        term_id: IDS.csfTermS26,
        credit_record_id: "10000000-0000-4000-8000-000000000208",
        event_type: "opportunity",
        title: "Hygiene Kit Drive",
        description: "Drive credit capped by CSF policy.",
        event_at: "2026-04-12T15:30:00-07:00",
        point_type: "drive",
        raw_points: 2,
        counted_points: 2,
        status: "verified",
        source: "manual",
        source_ref: { driveCapApplied: true },
      },
      {
        id: "10000000-0000-4000-8000-000000000213",
        organization_id: IDS.csfOrg,
        profile_id: IDS.csfProfilePending,
        term_id: IDS.csfTermS26,
        opportunity_id: IDS.csfOpportunityFoodBank,
        credit_record_id: "10000000-0000-4000-8000-000000000209",
        event_type: "opportunity",
        title: "Food Bank Sorting Pending",
        description: "Waiting for officer approval.",
        event_at: "2026-03-21T12:00:00-07:00",
        point_type: "non_drive",
        raw_points: 3,
        counted_points: 0,
        status: "pending",
        source: "submission",
        source_ref: { submissionId: "10000000-0000-4000-8000-000000000204" },
      },
    ]),
  );

  await must(
    "csf-expanded-partner-clubs",
    pluginDb.from("csf_partner_clubs").upsert(
      [
        {
          id: IDS.csfPartnerLibrary,
          organization_id: IDS.csfOrg,
          name: "DVHS Library",
          club_type: "school_department",
          contact_name: "Ms. Hernandez",
          contact_email: "dvhs.library@example.test",
          president_name: "Priya Shah",
          advisor_name: "Ms. Hernandez",
          recruiting_new_members: true,
          public_description:
            "Library support, tutoring, shelving, and literacy events approved for CSF non-drive credit.",
          communication_method: "Email and shared Google Sheet",
          approved_point_types: ["non_drive"],
          notes: "Use weekly tutoring roster for verification.",
          status: "active",
          created_by: users.csfOfficer.id,
        },
      ],
      { onConflict: "organization_id,name" },
    ),
  );

  await must(
    "csf-expanded-partner-batch",
    pluginDb.from("csf_partner_submission_batches").upsert({
      id: IDS.csfPartnerBatch,
      organization_id: IDS.csfOrg,
      partner_club_id: IDS.csfPartnerLibrary,
      term_id: IDS.csfTermS26,
      title: "March Library Tutoring Roster",
      source: "sheet",
      source_url:
        "https://docs.google.com/spreadsheets/d/local-library-tutoring/edit",
      status: "needs_verification",
      submitted_by: users.csfOfficer.id,
      summary: { rows: 14, matched: 11, ambiguous: 2, rejected: 1 },
    }),
  );

  await must(
    "csf-expanded-sheet-jobs",
    pluginDb.from("csf_sheet_import_jobs").upsert([
      {
        id: IDS.csfSheetJobPreview,
        organization_id: IDS.csfOrg,
        source_id: IDS.csfSheetSource,
        initiated_by: users.csfOfficer.id,
        mode: "preview",
        status: "completed",
        summary: {
          rows: 6,
          uniqueProfiles: 5,
          matched: 3,
          newProfiles: 1,
          ambiguous: 1,
          rowsWithWarnings: 1,
          activityCount: 9,
          requirementsMet: 3,
        },
        started_at: "2026-03-18T18:09:00-07:00",
        completed_at: "2026-03-18T18:10:00-07:00",
        created_at: "2026-03-18T18:09:00-07:00",
      },
      {
        id: IDS.csfSheetJobCommit,
        organization_id: IDS.csfOrg,
        source_id: IDS.csfSheetSource,
        initiated_by: users.csfOfficer.id,
        mode: "commit",
        status: "completed",
        summary: { committed: 4, ambiguous: 1, failed: 1 },
        started_at: "2026-03-17T17:29:00-07:00",
        completed_at: "2026-03-17T17:30:00-07:00",
        created_at: "2026-03-17T17:29:00-07:00",
      },
    ]),
  );

  await must(
    "csf-expanded-sheet-rows",
    pluginDb.from("csf_sheet_import_rows").upsert([
      {
        id: "10000000-0000-4000-8000-000000000214",
        organization_id: IDS.csfOrg,
        job_id: IDS.csfSheetJobPreview,
        source_id: IDS.csfSheetSource,
        cohort_id: IDS.csfCohort2028,
        term_id: IDS.csfTermS26,
        sheet_tab_name: "S26",
        row_number: 12,
        source_range: "'S26'!A1:Z1000",
        raw_data: {
          First: "Maya",
          Last: "Patel",
          "SRVUSD Email": "maya.patel28@students.local.test",
          "All Reqs Met?": "TRUE",
        },
        normalized_data: {
          firstName: "Maya",
          lastName: "Patel",
          matchBasis: "email",
          schoolEmail: "maya.patel28@students.local.test",
        },
        row_hash: "local-maya-patel-row",
        matched_profile_id: IDS.csfProfileComplete,
        import_status: "updated",
        warnings: [],
        errors: [],
      },
      {
        id: "10000000-0000-4000-8000-000000000215",
        organization_id: IDS.csfOrg,
        job_id: IDS.csfSheetJobPreview,
        source_id: IDS.csfSheetSource,
        cohort_id: IDS.csfCohort2028,
        term_id: IDS.csfTermS26,
        sheet_tab_name: "S26",
        row_number: 18,
        source_range: "'S26'!A1:Z1000",
        raw_data: {
          First: "Maya",
          Last: "Patel",
          "SRVUSD Email": "",
          "All Reqs Met?": "TRUE",
        },
        normalized_data: {
          firstName: "Maya",
          lastName: "Patel",
          matchBasis: "name",
        },
        row_hash: "local-maya-patel-ambiguous-row",
        matched_profile_id: null,
        import_status: "ambiguous",
        warnings: ["Two CSF profiles share this normalized name."],
        errors: [],
      },
      {
        id: "10000000-0000-4000-8000-000000000216",
        organization_id: IDS.csfOrg,
        job_id: IDS.csfSheetJobPreview,
        source_id: IDS.csfSheetSource,
        cohort_id: IDS.csfCohort2029,
        term_id: IDS.csfTermS26,
        sheet_tab_name: "S26",
        row_number: 24,
        source_range: "'S26'!A1:Z1000",
        raw_data: {
          First: "Sofia",
          Last: "",
          "SRVUSD Email": "sofia.nguyen29@students.local.test",
        },
        normalized_data: {
          firstName: "Sofia",
          lastName: "",
          matchBasis: "email",
          schoolEmail: "sofia.nguyen29@students.local.test",
        },
        row_hash: "local-sofia-incomplete-row",
        matched_profile_id: IDS.csfProfileMissingHours,
        import_status: "error",
        warnings: ["Row has an incomplete name."],
        errors: ["Row has an incomplete name."],
      },
    ]),
  );

  await must(
    "csf-expanded-sheet-logs",
    pluginDb.from("csf_sheet_sync_logs").upsert([
      {
        id: "10000000-0000-4000-8000-000000000217",
        organization_id: IDS.csfOrg,
        source_id: IDS.csfSheetSource,
        job_id: IDS.csfSheetJobPreview,
        level: "warning",
        message: "Preview completed with rows needing officer review",
        details: { ambiguous: 1, warnings: 1, source: "S26" },
        created_by: users.csfOfficer.id,
        created_at: "2026-03-18T18:10:00-07:00",
      },
      {
        id: "10000000-0000-4000-8000-000000000218",
        organization_id: IDS.csfOrg,
        source_id: IDS.csfSheetSource,
        job_id: IDS.csfSheetJobCommit,
        level: "info",
        message: "Commit completed",
        details: { committed: 4, ambiguous: 1, failed: 1 },
        created_by: users.csfOfficer.id,
        created_at: "2026-03-17T17:30:00-07:00",
      },
    ]),
  );

  await must(
    "csf-expanded-announcements",
    pluginDb.from("csf_announcements").upsert([
      {
        id: IDS.csfAnnouncementPinned,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Spring service hours checkpoint",
        body: "Members should have at least 4 verified points by April 15. Check your CSF profile and submit missing evidence before the deadline.",
        audience: "members",
        status: "published",
        pinned: true,
        published_at: "2026-03-25T12:00:00-07:00",
        expires_at: "2026-04-16T00:00:00-07:00",
        created_by: users.csfOfficer.id,
      },
      {
        id: IDS.csfAnnouncementOfficer,
        organization_id: IDS.csfOrg,
        term_id: IDS.csfTermS26,
        title: "Officer roster review",
        body: "Review ambiguous workbook rows and pending food bank submissions before the Friday officer meeting.",
        audience: "officers",
        status: "scheduled",
        pinned: false,
        published_at: "2026-04-03T08:00:00-07:00",
        created_by: users.csfOfficer.id,
      },
    ]),
  );

  await must(
    "csf-expanded-audit-events",
    pluginDb.from("csf_admin_audit_events").upsert([
      {
        id: "10000000-0000-4000-8000-000000000219",
        organization_id: IDS.csfOrg,
        actor_user_id: users.csfOfficer.id,
        action: "sheets.preview",
        target_type: "csf_sheet_sources",
        target_id: IDS.csfSheetSource,
        term_id: IDS.csfTermS26,
        after_data: { rows: 6, ambiguous: 1, warnings: 1 },
        created_at: "2026-03-18T18:10:00-07:00",
      },
      {
        id: "10000000-0000-4000-8000-000000000220",
        organization_id: IDS.csfOrg,
        actor_user_id: users.csfOfficer.id,
        action: "submission.approved",
        target_type: "csf_point_submissions",
        target_id: "10000000-0000-4000-8000-000000000206",
        term_id: IDS.csfTermS26,
        after_data: { title: "Food bank sorting verified", points: 3 },
        created_at: "2026-03-21T13:25:00-07:00",
      },
    ]),
  );

  await must(
    "public-project",
    admin.from("projects").upsert({
      id: IDS.publicProject,
      creator_id: users.developer.id,
      organization_id: IDS.nonprofitOrg,
      title: "Local Community Food Drive",
      location: "San Ramon Community Center",
      description:
        "Public local fixture project for discovery, signup, and plugin platform smoke tests.",
      event_type: "oneTime",
      verification_method: "manual",
      schedule: {
        oneTime: {
          date: "2026-12-05",
          startTime: "09:00",
          endTime: "13:00",
          volunteers: 25,
        },
      },
      status: "upcoming",
      visibility: "public",
      require_login: false,
    }),
  );

  await must(
    "org-project",
    admin.from("projects").upsert({
      id: IDS.orgProject,
      creator_id: users.developer.id,
      organization_id: IDS.primaryOrg,
      title: "Local Platform Member Day",
      location: "Local Platform Org",
      description:
        "Organization-scoped fixture project for authenticated local workflows.",
      event_type: "oneTime",
      verification_method: "manual",
      schedule: {
        oneTime: {
          date: "2026-11-14",
          startTime: "10:00",
          endTime: "15:00",
          volunteers: 40,
        },
      },
      status: "upcoming",
      visibility: "organization_only",
      require_login: true,
    }),
  );

  console.log("Seeding complete! Local platform account seeded:");
  console.log({
    email: "riddhiman.rana@gmail.com",
    password: "robo6737",
    role: "admin (all 3 platform orgs)",
    dvPlugin: "disabled by default",
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
