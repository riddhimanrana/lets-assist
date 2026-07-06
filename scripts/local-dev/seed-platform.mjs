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
  csfCohort2028: "10000000-0000-4000-8000-000000000102",
  csfProfileMember: "10000000-0000-4000-8000-000000000103",
  csfProfileRestricted: "10000000-0000-4000-8000-000000000104",
  csfSheetSource: "10000000-0000-4000-8000-000000000105",
  csfOpportunity: "10000000-0000-4000-8000-000000000106",
  csfActivityOpportunity: "10000000-0000-4000-8000-000000000107",
  csfActivityMeeting: "10000000-0000-4000-8000-000000000108",
  csfRestriction: "10000000-0000-4000-8000-000000000109",
  csfRoleOwner: "10000000-0000-4000-8000-000000000110",
  csfRoleActivityCoordinator: "10000000-0000-4000-8000-000000000111",
  csfStaffPosition: "10000000-0000-4000-8000-000000000112",
  csfPartnerClub: "10000000-0000-4000-8000-000000000113",
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
    fullName: "Student TwentyEight",
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
    description: "Server-rendered calendar workflow helpers for organization projects.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "community-impact-radar",
    name: "Community Impact Radar",
    description: "Organization impact analytics surfaces backed by host-controlled read paths.",
    visibility: "global",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "dvhs-csf",
    name: "DVHS CSF",
    description: "Private CSF workflow system for cohort membership, applications, officer roles, points, posts, and sheets.",
    visibility: "private",
    is_active: true,
    latest_version: "0.1.0",
    private_codebase: true,
  },
  {
    key: "family-liaison-workbench",
    name: "Family Liaison Workbench",
    description: "Staff-only liaison workflow surfaces for signup and family support pilots.",
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
    const retryable = status === 502 || status === 503 || status === 504 || status === undefined;
    if (!retryable || attempt === 5) break;
    await sleep(500 * attempt);
  }

  throw new Error(`${label} failed: ${lastError?.message ?? "unknown Supabase Auth error"}`);
}

async function upsertAuthUser(admin, account) {
  const { data: listed } = await retrySupabaseAuthRequest("List local auth users", () =>
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
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, payload);
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

  await must("trusted-member-developer", admin.from("trusted_member").upsert({
    id: users.developer.id,
    user_id: users.developer.id,
    name: "Riddhiman Rana",
    email: "riddhiman.rana@gmail.com",
    status: true,
    reason: "Developer admin access",
  }, { onConflict: "id" }));

  const organizations = [
    {
      id: IDS.primaryOrg,
      name: "Local Platform Org",
      username: "local-platform-org",
      type: "nonprofit",
      description: "Default local organization for plugin platform and data-isolation testing.",
      join_code: "LOCAL1",
      created_by: users.developer.id,
    },
    {
      id: IDS.nonprofitOrg,
      name: "Acts of Hearts",
      username: "acts-of-hearts",
      type: "nonprofit",
      description: "Local nonprofit fixture for public project and organization workflows.",
      join_code: "AOHLC1",
      created_by: users.developer.id,
    },
    {
      id: IDS.schoolOrg,
      name: "Local School Volunteers",
      username: "local-school-volunteers",
      type: "school",
      description: "Local school organization fixture for membership isolation checks.",
      join_code: "SCHOOL",
      created_by: users.developer.id,
    },
    {
      id: IDS.csfOrg,
      name: "DVHS CSF",
      username: "dvhs-csf",
      type: "school",
      description: "Deterministic local fixture for the DVHS CSF private plugin.",
      join_code: "DVCSF1",
      created_by: users.developer.id,
    },
  ];

  await must("organizations", admin.from("organizations").upsert(organizations));

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
    admin.from("organization_members").upsert(
      membershipRows,
      { onConflict: "organization_id,user_id" },
    ),
  );

  await must("plugin catalog", admin.from("plugins").upsert(pluginCatalogRows, {
    onConflict: "key",
  }));

  for (const pluginKey of pluginKeys) {
    const entitledOrgIds =
      pluginKey === "dvhs-csf"
        ? [IDS.csfOrg]
        : orgIds.filter((orgId) => orgId !== IDS.csfOrg);
    for (const orgId of entitledOrgIds) {
      await must(`entitlement-${pluginKey}-${orgId}`, admin.from("organization_plugin_entitlements").upsert({
        organization_id: orgId,
        plugin_key: pluginKey,
        status: "active",
        is_forced: false,
        created_by: users.developer.id,
      }, { onConflict: "organization_id,plugin_key" }));

      await must(`install-${pluginKey}-${orgId}`, admin.from("organization_plugin_installs").upsert({
        organization_id: orgId,
        plugin_key: pluginKey,
        enabled: true,
        installed_version: "0.1.0",
        installed_by: users.developer.id,
        configuration: {
          localFixture: true,
          serverOnlyDataAccess: true,
        },
      }, { onConflict: "organization_id,plugin_key" }));
    }
  }

  const pluginDb = admin.schema("plugin_data");
  await must("csf-roles", pluginDb.from("csf_roles").upsert([
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
  ], { onConflict: "organization_id,key" }));

  await must("csf-role-permissions", pluginDb.from("csf_role_permissions").upsert([
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
  ], { onConflict: "role_id,permission_key" }));

  await must("csf-staff-position", pluginDb.from("csf_staff_positions").upsert({
    id: IDS.csfStaffPosition,
    organization_id: IDS.csfOrg,
    user_id: users.csfOfficer.id,
    role_id: IDS.csfRoleActivityCoordinator,
    school_year: "2025-2026",
    display_title: "Activity Coordinator",
    status: "active",
    appointed_by: users.developer.id,
    notes: "Local fixture officer.",
  }));

  await must("csf-term-s26", pluginDb.from("csf_terms").upsert({
    id: IDS.csfTermS26,
    organization_id: IDS.csfOrg,
    code: "S26",
    label: "Spring 2026",
    school_year: "2025-2026",
    semester: "spring",
    is_current: true,
  }, { onConflict: "organization_id,code" }));

  await must("csf-cohort-2028", pluginDb.from("csf_cohorts").upsert({
    id: IDS.csfCohort2028,
    organization_id: IDS.csfOrg,
    graduation_year: 2028,
    label: "Class of 2028",
    status: "active",
  }, { onConflict: "organization_id,graduation_year" }));

  await must("csf-cohort-term", pluginDb.from("csf_cohort_terms").upsert({
    organization_id: IDS.csfOrg,
    cohort_id: IDS.csfCohort2028,
    term_id: IDS.csfTermS26,
    grade_level: 10,
    sheet_tab_name: "S26",
  }, { onConflict: "cohort_id,term_id" }));

  await must("csf-profiles", pluginDb.from("csf_profiles").upsert([
    {
      id: IDS.csfProfileMember,
      organization_id: IDS.csfOrg,
      first_name: "Student",
      last_name: "TwentyEight",
      preferred_name: "Student",
      school_email: "student.2028@students.local.test",
      personal_email: "student.2028@local.test",
      normalized_first_name: "student",
      normalized_last_name: "twentyeight",
      normalized_school_email: "student.2028@students.local.test",
      normalized_personal_email: "student.2028@local.test",
      source_summary: { localFixture: true },
    },
    {
      id: IDS.csfProfileRestricted,
      organization_id: IDS.csfOrg,
      first_name: "Manual",
      last_name: "Review",
      school_email: "manual.review@students.local.test",
      normalized_first_name: "manual",
      normalized_last_name: "review",
      normalized_school_email: "manual.review@students.local.test",
      source_summary: { localFixture: true },
    },
  ]));

  await must("csf-profile-memberships", pluginDb.from("csf_profile_cohort_memberships").upsert([
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
  ], { onConflict: "profile_id,cohort_id" }));

  await must("csf-profile-account", pluginDb.from("csf_profile_accounts").upsert({
    organization_id: IDS.csfOrg,
    profile_id: IDS.csfProfileMember,
    user_id: users.csfMember.id,
    status: "verified",
    is_primary: true,
    linked_by: users.developer.id,
  }, { onConflict: "organization_id,profile_id,user_id" }));

  await must("csf-point-rules", pluginDb.from("csf_term_point_rules").upsert([
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
  ], { onConflict: "organization_id,term_id,point_type" }));

  await must("csf-sheet-source", pluginDb.from("csf_sheet_sources").upsert({
    id: IDS.csfSheetSource,
    organization_id: IDS.csfOrg,
    cohort_id: IDS.csfCohort2028,
    title: "Class of 2028 workbook",
    provider: "google_sheets",
    spreadsheet_id: "local-csf-sheet-fixture",
    sheet_url: "https://docs.google.com/spreadsheets/d/local-csf-sheet-fixture",
    sync_owner_user_id: users.developer.id,
    sync_mode: "manual",
    tab_mappings: [{ cohortYear: 2028, termCode: "S26", tabName: "S26", rangeA1: "A1:Z1000" }],
  }, { onConflict: "organization_id,cohort_id,title" }));

  await must("csf-onboarding-link", pluginDb.from("csf_onboarding_links").upsert({
    organization_id: IDS.csfOrg,
    term_id: IDS.csfTermS26,
    cohort_id: IDS.csfCohort2028,
    sheet_source_id: IDS.csfSheetSource,
    code: "S26-2028",
    title: "Spring 2026 Class of 2028",
    link_type: "combined",
    google_form_url: "https://docs.google.com/forms/d/local-csf-form-fixture/viewform",
    landing_message: "Connect your Let’s Assist profile, then complete the official CSF Google Form.",
    is_active: true,
    created_by: users.developer.id,
  }, { onConflict: "organization_id,code" }));

  await must("csf-opportunity", pluginDb.from("csf_opportunities").upsert({
    id: IDS.csfOpportunity,
    organization_id: IDS.csfOrg,
    term_id: IDS.csfTermS26,
    title: "Quail Run Suessical Musical",
    body: "Quail Run is hosting their Suessical Musical and has volunteer slots open.",
    starts_at: "2026-05-08T17:15:00-07:00",
    ends_at: "2026-05-08T19:15:00-07:00",
    location: "Quail Run Elementary School",
    signup_url: "https://docs.google.com/spreadsheets/d/local-quail-run-signup/edit",
    contact_email: "sandralei@gmail.com",
    point_value: 2,
    point_type: "non_drive",
    signup_mode: "external",
    requires_point_submission: true,
    evidence_policy: "optional",
    source_organization: "Quail Run Elementary School",
    created_by_user_id: users.csfOfficer.id,
    status: "published",
    external_sheet_url: "https://docs.google.com/spreadsheets/d/local-quail-run-signup/edit",
    sheet_export_status: "not_exported",
    published_at: "2026-05-07T12:00:00-07:00",
  }));

  await must("csf-partner-club", pluginDb.from("csf_partner_clubs").upsert({
    id: IDS.csfPartnerClub,
    organization_id: IDS.csfOrg,
    name: "Quail Run Elementary School",
    contact_name: "Sandra Lei",
    contact_email: "sandralei@gmail.com",
    approved_point_types: ["non_drive"],
    notes: "Fixture partner source for imported participant sheets.",
    status: "active",
    created_by: users.csfOfficer.id,
  }, { onConflict: "organization_id,name" }));

  await must("csf-activity-events", pluginDb.from("csf_profile_activity_events").upsert([
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
  ]));

  await must("csf-restriction", pluginDb.from("csf_profile_restrictions").upsert({
    id: IDS.csfRestriction,
    organization_id: IDS.csfOrg,
    profile_id: IDS.csfProfileRestricted,
    scope: "manual_review_required",
    status: "active",
    reason_category: "local_fixture",
    private_notes: "Fixture profile used to verify staff-only restriction handling.",
    visible_message: "Your CSF profile needs staff review.",
    created_by: users.developer.id,
  }));

  await must("public-project", admin.from("projects").upsert({
    id: IDS.publicProject,
    creator_id: users.developer.id,
    organization_id: IDS.nonprofitOrg,
    title: "Local Community Food Drive",
    location: "San Ramon Community Center",
    description: "Public local fixture project for discovery, signup, and plugin platform smoke tests.",
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
  }));

  await must("org-project", admin.from("projects").upsert({
    id: IDS.orgProject,
    creator_id: users.developer.id,
    organization_id: IDS.primaryOrg,
    title: "Local Platform Member Day",
    location: "Local Platform Org",
    description: "Organization-scoped fixture project for authenticated local workflows.",
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
  }));

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
