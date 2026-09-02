#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  buildSyntheticAccounts,
  buildSyntheticMemberProfiles,
  FIXTURE_COHORT_ID,
  FIXTURE_MARKER,
  FIXTURE_ORGANIZATION_HANDLE,
  FIXTURE_ORGANIZATION_ID,
  FIXTURE_ORGANIZATION_JOIN_CODE,
  FIXTURE_REVIEW_PERIOD_ID,
  FIXTURE_ROLE_ID,
  FIXTURE_TERM_ID,
  FORBIDDEN_ORGANIZATION_HANDLE,
  MEMBER_PROFILE_COUNT,
  MEMBER_SESSION_COUNT,
  OFFICER_SESSION_COUNT,
  PRODUCTION_PROJECT_REF,
} from "./csf-load-fixture.mjs";

export {
  buildSyntheticAccounts,
  buildSyntheticMemberProfiles,
  FIXTURE_COHORT_ID,
  FIXTURE_MARKER,
  FIXTURE_ORGANIZATION_HANDLE,
  FIXTURE_ORGANIZATION_ID,
  FIXTURE_ORGANIZATION_JOIN_CODE,
  FIXTURE_REVIEW_PERIOD_ID,
  FIXTURE_ROLE_ID,
  FIXTURE_TERM_ID,
  FORBIDDEN_ORGANIZATION_HANDLE,
  MEMBER_PROFILE_COUNT,
  MEMBER_SESSION_COUNT,
  OFFICER_SESSION_COUNT,
  PRODUCTION_PROJECT_REF,
};

const FIXTURE_NAME = "CSF hosted load fixture";
const validatedProvisionTargets = new WeakSet();
const OFFICER_PERMISSIONS = [
  "manage_roles",
  "manage_cohorts_terms",
  "manage_profiles",
  "review_applications",
  "view_applications",
  "review_application_checks",
  "decide_applications",
  "assign_applications",
  "write_application_notes",
  "manage_payment_review",
  "process_points",
  "verify_submissions",
  "manage_review_periods",
  "manage_sheet_sync",
  "resolve_imports",
  "manage_settings",
];

class FixtureProvisionError extends Error {}

function fail(message) {
  throw new FixtureProvisionError(message);
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function rememberValidatedTarget(target) {
  validatedProvisionTargets.add(target);
  return target;
}

/** @param {Record<string, string | undefined>} [environment] */
export function validateProvisionTarget(environment = process.env) {
  const projectRef = required(
    environment,
    "EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF",
  ).toLowerCase();
  if (
    !/^[a-z0-9]{20}$/u.test(projectRef) ||
    projectRef === PRODUCTION_PROJECT_REF
  ) {
    fail("Fixture provisioning requires a non-Production Supabase project.");
  }

  const requestedHandle =
    environment.CSF_HOSTED_LOAD_ORGANIZATION_HANDLE?.trim().toLowerCase() ??
    FIXTURE_ORGANIZATION_HANDLE;
  if (requestedHandle === FORBIDDEN_ORGANIZATION_HANDLE) {
    fail("Fixture provisioning refuses the real DVHS organization.");
  }
  if (requestedHandle !== FIXTURE_ORGANIZATION_HANDLE) {
    fail("Fixture provisioning is pinned to its synthetic organization.");
  }

  const confirmation = required(
    environment,
    "CSF_HOSTED_LOAD_PROVISION_CONFIRMATION",
  );
  if (
    confirmation !==
    `provision-hosted-development:${projectRef}:${FIXTURE_ORGANIZATION_HANDLE}`
  ) {
    fail("The hosted fixture confirmation does not match the target.");
  }

  let supabaseUrl;
  try {
    supabaseUrl = new URL(required(environment, "SUPABASE_URL"));
  } catch {
    fail("SUPABASE_URL is malformed.");
  }
  if (
    supabaseUrl.origin !== `https://${projectRef}.supabase.co` ||
    supabaseUrl.pathname !== "/"
  ) {
    fail("SUPABASE_URL does not match the Development project ref.");
  }

  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey.length < 32 || /[\r\n]/u.test(serviceRoleKey)) {
    fail("SUPABASE_SERVICE_ROLE_KEY is malformed.");
  }
  const password = required(environment, "CSF_HOSTED_LOAD_PASSWORD");
  if (password.length < 20 || /[\r\n]/u.test(password)) {
    fail("CSF_HOSTED_LOAD_PASSWORD is malformed.");
  }

  return rememberValidatedTarget({
    environmentKind: "hosted-development",
    organizationHandle: requestedHandle,
    password,
    projectRef,
    serviceRoleKey,
    supabaseUrl: supabaseUrl.origin,
  });
}

/** @param {Record<string, string | undefined>} [environment] */
export function validateIsolatedProvisionTarget(environment = process.env) {
  if (
    required(environment, "CSF_LOCAL_LOAD_PROVISION_CONFIRMATION") !==
    `provision-isolated-local:${FIXTURE_ORGANIZATION_HANDLE}`
  ) {
    fail("The isolated fixture confirmation does not match the target.");
  }
  const requestedHandle =
    environment.CSF_HOSTED_LOAD_ORGANIZATION_HANDLE?.trim().toLowerCase() ??
    FIXTURE_ORGANIZATION_HANDLE;
  if (requestedHandle === FORBIDDEN_ORGANIZATION_HANDLE) {
    fail("Fixture provisioning refuses the real DVHS organization.");
  }
  if (requestedHandle !== FIXTURE_ORGANIZATION_HANDLE) {
    fail("Fixture provisioning is pinned to its synthetic organization.");
  }

  let supabaseUrl;
  try {
    supabaseUrl = new URL(required(environment, "SUPABASE_URL"));
  } catch {
    fail("SUPABASE_URL is malformed.");
  }
  if (
    supabaseUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(supabaseUrl.hostname) ||
    supabaseUrl.pathname !== "/" ||
    !supabaseUrl.port
  ) {
    fail("Isolated fixture provisioning requires a loopback Supabase URL.");
  }

  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey.length < 32 || /[\r\n]/u.test(serviceRoleKey)) {
    fail("SUPABASE_SERVICE_ROLE_KEY is malformed.");
  }
  const password = required(environment, "CSF_HOSTED_LOAD_PASSWORD");
  if (password.length < 20 || /[\r\n]/u.test(password)) {
    fail("CSF_HOSTED_LOAD_PASSWORD is malformed.");
  }

  return rememberValidatedTarget({
    environmentKind: "isolated-local",
    organizationHandle: FIXTURE_ORGANIZATION_HANDLE,
    password,
    projectRef: "isolated-local",
    serviceRoleKey,
    supabaseUrl: supabaseUrl.origin,
  });
}

export function assertSyntheticOrganizationBoundary(rows) {
  for (const row of rows ?? []) {
    if (
      row.username === FORBIDDEN_ORGANIZATION_HANDLE ||
      (row.id === FIXTURE_ORGANIZATION_ID &&
        row.username !== FIXTURE_ORGANIZATION_HANDLE)
    ) {
      fail("Fixture provisioning refuses the real DVHS organization.");
    }
    if (
      row.username === FIXTURE_ORGANIZATION_HANDLE &&
      (row.id !== FIXTURE_ORGANIZATION_ID || row.description !== FIXTURE_MARKER)
    ) {
      fail(
        "The synthetic organization handle is already owned by another row.",
      );
    }
    if (
      row.join_code === FIXTURE_ORGANIZATION_JOIN_CODE &&
      row.id !== FIXTURE_ORGANIZATION_ID
    ) {
      fail("The synthetic organization join code is already in use.");
    }
  }
}

export function buildFixtureRows(usersByKey) {
  const accounts = buildSyntheticAccounts();
  const allAccounts = [...accounts.members, ...accounts.officers];
  const memberRoster = buildSyntheticMemberProfiles(accounts.members);
  const officerOne = usersByKey.get(accounts.officers[0].key);
  if (!officerOne?.id) fail("The first synthetic officer account is missing.");

  const memberProfileRows = memberRoster.map((member) => ({
    id: member.profileId,
    organization_id: FIXTURE_ORGANIZATION_ID,
    first_name: "Load",
    last_name: `Member${member.ordinal}`,
    preferred_name: `Member ${member.ordinal}`,
    personal_email: member.email,
    normalized_first_name: "load",
    normalized_last_name: `member${member.ordinal}`,
    normalized_personal_email: member.email,
    privacy_flags: { syntheticFixture: true },
    source_summary: { fixtureContract: FIXTURE_MARKER },
  }));
  const officerProfileRows = accounts.officers.map((account) => {
    const ordinal = account.key.slice(-3);
    return {
      id: account.profileId,
      organization_id: FIXTURE_ORGANIZATION_ID,
      first_name: "Load",
      last_name: `Officer${ordinal}`,
      preferred_name: `Officer ${ordinal}`,
      personal_email: account.email,
      normalized_first_name: "load",
      normalized_last_name: `officer${ordinal}`,
      normalized_personal_email: account.email,
      privacy_flags: { syntheticFixture: true },
      source_summary: { fixtureContract: FIXTURE_MARKER },
    };
  });
  const profiles = [...memberProfileRows, ...officerProfileRows];
  const profileByKey = new Map([
    ...memberRoster.map((member, index) => [
      member.key,
      memberProfileRows[index],
    ]),
    ...accounts.officers.map((account, index) => [
      account.key,
      officerProfileRows[index],
    ]),
  ]);

  const profileAccounts = allAccounts.map((account) => ({
    organization_id: FIXTURE_ORGANIZATION_ID,
    profile_id: profileByKey.get(account.key).id,
    user_id: usersByKey.get(account.key).id,
    status: "verified",
    is_primary: true,
    linked_by: officerOne.id,
    notes: "Synthetic hosted load fixture.",
  }));
  const profileCohorts = memberProfileRows.map((profile) => ({
    organization_id: FIXTURE_ORGANIZATION_ID,
    profile_id: profile.id,
    cohort_id: FIXTURE_COHORT_ID,
    status: "active",
  }));
  const termMemberships = memberProfileRows.map((profile) => ({
    organization_id: FIXTURE_ORGANIZATION_ID,
    profile_id: profile.id,
    cohort_id: FIXTURE_COHORT_ID,
    term_id: FIXTURE_TERM_ID,
    application_id: null,
    status: "active",
    status_reason: "Synthetic hosted load fixture.",
    accepted_at: "2026-08-20T17:00:00-07:00",
    activated_at: "2026-08-20T17:00:00-07:00",
  }));
  const applications = memberRoster.map((member, index) => {
    return {
      id: member.applicationId,
      organization_id: FIXTURE_ORGANIZATION_ID,
      profile_id: member.profileId,
      cohort_id: FIXTURE_COHORT_ID,
      term_id: FIXTURE_TERM_ID,
      source: "manual",
      status: "needs_review",
      submission_status: "ready",
      eligibility_status: "pending",
      decision_status: "pending",
      current_grade_level: 11,
      returning_status: index % 2 === 0 ? "returning" : "new",
      shirt_size: "returning_member",
      most_checked_email: member.email,
      list_i_points: 5,
      list_i_ii_points: 3,
      grand_total_points: 8,
      social_confirmation: true,
      submitted_at: `2026-08-2${index % 10}T${String(index % 24).padStart(2, "0")}:00:00-07:00`,
      application_data: {
        fixtureContract: FIXTURE_MARKER,
        fixtureOrdinal: member.ordinal,
      },
    };
  });
  const staffPositions = accounts.officers.map((account) => ({
    id: account.staffPositionId,
    organization_id: FIXTURE_ORGANIZATION_ID,
    profile_id: profileByKey.get(account.key).id,
    user_id: usersByKey.get(account.key).id,
    role_id: FIXTURE_ROLE_ID,
    school_year: "2026-2027",
    display_title: "Load test officer",
    status: "active",
    appointed_by: officerOne.id,
    notes: "Synthetic hosted load fixture.",
  }));

  return {
    accounts,
    allAccounts,
    applications,
    officerOne,
    profileAccounts,
    profileCohorts,
    profiles,
    staffPositions,
    staffViewPreferences: accounts.officers.map((account) => ({
      organization_id: FIXTURE_ORGANIZATION_ID,
      user_id: usersByKey.get(account.key).id,
      view_mode: "officer",
    })),
    termMemberships,
  };
}

function createAdminClient(target) {
  return createClient(target.supabaseUrl, target.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function must(label, operation) {
  let result;
  try {
    result = await operation;
  } catch {
    fail(`${label} failed.`);
  }
  if (result.error) fail(`${label} failed.`);
  return result.data;
}

async function retryAuth(label, operation) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    let result;
    try {
      result = await operation();
    } catch {
      fail(`${label} failed.`);
    }
    if (!result.error) return result.data;
    if (result.error.status !== 429 || attempt === 6) {
      fail(`${label} failed.`);
    }
    await new Promise((resolveDelay) =>
      setTimeout(resolveDelay, attempt * 1_000),
    );
  }
  fail(`${label} failed.`);
}

function assertOwnedFixtureAccount(user, account) {
  if (!user) return;
  if (
    user.id !== account.authUserId ||
    user.app_metadata?.csf_hosted_load_fixture !== true ||
    user.app_metadata?.fixture_contract !== FIXTURE_MARKER ||
    user.app_metadata?.organization_handle !== FIXTURE_ORGANIZATION_HANDLE ||
    user.app_metadata?.fixture_role !== account.role ||
    user.user_metadata?.username !== account.username ||
    user.email?.toLowerCase() !== account.email
  ) {
    fail("A synthetic account address is already owned by another account.");
  }
}

async function upsertAuthAccounts(admin, password) {
  const accounts = buildSyntheticAccounts();
  const allAccounts = [...accounts.members, ...accounts.officers];
  const usersByKey = new Map();

  for (const account of allAccounts) {
    const lookup = await admin.auth.admin.getUserById(account.authUserId);
    if (lookup.error && lookup.error.status !== 404) {
      fail("Reading a synthetic auth account failed.");
    }
    const existing = lookup.data?.user ?? null;
    assertOwnedFixtureAccount(existing, account);
    const payload = {
      password,
      email_confirm: true,
      app_metadata: {
        csf_hosted_load_fixture: true,
        fixture_contract: FIXTURE_MARKER,
        organization_handle: FIXTURE_ORGANIZATION_HANDLE,
        fixture_role: account.role,
      },
      user_metadata: {
        full_name: account.fullName,
        username: account.username,
        has_completed_onboarding: true,
        has_completed_intro_tour: true,
        csf_hosted_load_fixture: true,
      },
    };
    const data = existing
      ? await retryAuth("Updating a synthetic auth account", () =>
          admin.auth.admin.updateUserById(existing.id, payload),
        )
      : await retryAuth("Creating a synthetic auth account", () =>
          admin.auth.admin.createUser({
            id: account.authUserId,
            email: account.email,
            ...payload,
          }),
        );
    if (!data.user?.id) fail("A synthetic auth account returned no identity.");
    usersByKey.set(account.key, data.user);
  }
  return usersByKey;
}

async function upsertRows(client, table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 100) {
    await must(
      `Upserting ${table}`,
      client.from(table).upsert(rows.slice(index, index + 100), { onConflict }),
    );
  }
}

async function countOrganizationRows(client, table) {
  const result = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", FIXTURE_ORGANIZATION_ID);
  if (result.error || !Number.isInteger(result.count)) {
    fail(`Counting ${table} failed.`);
  }
  return result.count;
}

async function assertRemoteOrganizationBoundary(publicDb) {
  const { data, error } = await publicDb
    .from("organizations")
    .select("id, username, description, join_code")
    .or(
      `id.eq.${FIXTURE_ORGANIZATION_ID},username.eq.${FIXTURE_ORGANIZATION_HANDLE},join_code.eq.${FIXTURE_ORGANIZATION_JOIN_CODE}`,
    );
  if (error) fail("Checking the synthetic organization boundary failed.");
  assertSyntheticOrganizationBoundary(data);
}

async function assertFixtureIdsStayScoped(client, table, ids) {
  for (let index = 0; index < ids.length; index += 100) {
    const result = await client
      .from(table)
      .select("id, organization_id")
      .in("id", ids.slice(index, index + 100));
    if (result.error) fail(`Checking ${table} identity ownership failed.`);
    if (
      (result.data ?? []).some(
        ({ organization_id: organizationId }) =>
          organizationId !== FIXTURE_ORGANIZATION_ID,
      )
    ) {
      fail(`A fixed ${table} identity belongs to another organization.`);
    }
  }
}

async function assertRemoteFixtureIdentityBoundary(pluginDb) {
  const accounts = buildSyntheticAccounts();
  const roster = buildSyntheticMemberProfiles(accounts.members);
  await assertFixtureIdsStayScoped(pluginDb, "csf_terms", [FIXTURE_TERM_ID]);
  await assertFixtureIdsStayScoped(pluginDb, "csf_cohorts", [
    FIXTURE_COHORT_ID,
  ]);
  await assertFixtureIdsStayScoped(pluginDb, "csf_roles", [FIXTURE_ROLE_ID]);
  await assertFixtureIdsStayScoped(pluginDb, "csf_review_periods", [
    FIXTURE_REVIEW_PERIOD_ID,
  ]);
  await assertFixtureIdsStayScoped(pluginDb, "csf_profiles", [
    ...roster.map(({ profileId }) => profileId),
    ...accounts.officers.map(({ profileId }) => profileId),
  ]);
  await assertFixtureIdsStayScoped(
    pluginDb,
    "csf_term_applications",
    roster.map(({ applicationId }) => applicationId),
  );
  await assertFixtureIdsStayScoped(
    pluginDb,
    "csf_staff_positions",
    accounts.officers.map(({ staffPositionId }) => staffPositionId),
  );
}

export async function provisionDatabase(target) {
  if (
    !target ||
    !validatedProvisionTargets.has(target) ||
    target.organizationHandle !== FIXTURE_ORGANIZATION_HANDLE ||
    !["hosted-development", "isolated-local"].includes(target.environmentKind)
  ) {
    fail("Fixture provisioning requires a validated target.");
  }
  const admin = createAdminClient(target);
  const publicDb = admin.schema("public");
  const pluginDb = admin.schema("plugin_data");
  await assertRemoteOrganizationBoundary(publicDb);
  await assertRemoteFixtureIdentityBoundary(pluginDb);

  const usersByKey = await upsertAuthAccounts(admin, target.password);
  const rows = buildFixtureRows(usersByKey);
  const officerId = rows.officerOne.id;

  await upsertRows(
    publicDb,
    "organizations",
    [
      {
        id: FIXTURE_ORGANIZATION_ID,
        name: FIXTURE_NAME,
        username: FIXTURE_ORGANIZATION_HANDLE,
        description: FIXTURE_MARKER,
        type: "school",
        join_code: FIXTURE_ORGANIZATION_JOIN_CODE,
        created_by: officerId,
        show_members_publicly: false,
      },
    ],
    "id",
  );
  await upsertRows(
    publicDb,
    "organization_members",
    rows.allAccounts.map((account) => ({
      organization_id: FIXTURE_ORGANIZATION_ID,
      user_id: usersByKey.get(account.key).id,
      role: account.role === "officer" ? "admin" : "member",
      status: "active",
      is_visible: false,
    })),
    "organization_id,user_id",
  );

  const plugin = await must(
    "Reading the CSF plugin catalog",
    publicDb
      .from("plugins")
      .select("key, latest_version")
      .eq("key", "dvhs-csf")
      .eq("is_active", true)
      .single(),
  );
  if (!plugin?.latest_version) fail("The CSF plugin catalog is unavailable.");
  await upsertRows(
    publicDb,
    "organization_plugin_entitlements",
    [
      {
        organization_id: FIXTURE_ORGANIZATION_ID,
        plugin_key: "dvhs-csf",
        status: "active",
        is_forced: false,
        created_by: officerId,
      },
    ],
    "organization_id,plugin_key",
  );
  await upsertRows(
    publicDb,
    "organization_plugin_installs",
    [
      {
        organization_id: FIXTURE_ORGANIZATION_ID,
        plugin_key: "dvhs-csf",
        enabled: true,
        installed_version: plugin.latest_version,
        installed_by: officerId,
        configuration: {
          fixtureContract: FIXTURE_MARKER,
          serverOnlyDataAccess: true,
        },
      },
    ],
    "organization_id,plugin_key",
  );

  await upsertRows(
    pluginDb,
    "csf_roles",
    [
      {
        id: FIXTURE_ROLE_ID,
        organization_id: FIXTURE_ORGANIZATION_ID,
        key: "load-test-officer",
        display_name: "Load test officer",
        description: "Synthetic hosted load fixture role.",
        role_type: "custom",
        is_system: false,
        sort_order: 900,
        public_title: "Load test officer",
        responsibility_label: "Synthetic acceptance",
        max_active_seats: OFFICER_SESSION_COUNT,
      },
    ],
    "id",
  );
  await upsertRows(
    pluginDb,
    "csf_role_permissions",
    OFFICER_PERMISSIONS.map((permission) => ({
      organization_id: FIXTURE_ORGANIZATION_ID,
      role_id: FIXTURE_ROLE_ID,
      permission_key: permission,
      enabled: true,
    })),
    "role_id,permission_key",
  );
  await upsertRows(
    pluginDb,
    "csf_terms",
    [
      {
        id: FIXTURE_TERM_ID,
        organization_id: FIXTURE_ORGANIZATION_ID,
        code: "F26",
        label: "Fall 2026",
        school_year: "2026-2027",
        semester: "fall",
        starts_at: "2026-08-04",
        ends_at: "2026-12-25",
        is_current: true,
        lifecycle_status: "open",
        settings: {
          fixtureContract: FIXTURE_MARKER,
          csfPointPolicy: { minimumTotalPoints: 7, maxDrivePoints: 2 },
        },
      },
    ],
    "id",
  );
  await upsertRows(
    pluginDb,
    "csf_term_policies",
    [
      {
        organization_id: FIXTURE_ORGANIZATION_ID,
        term_id: FIXTURE_TERM_ID,
        policy_version: 1,
        total_points_required: 7,
        max_drive_points: 2,
        max_points_per_activity: 3,
        required_meetings: 0,
        allowed_absences: 1,
        allow_point_carryover: false,
        created_by: officerId,
        updated_by: officerId,
        published_by: officerId,
      },
    ],
    "organization_id,term_id",
  );
  await upsertRows(
    pluginDb,
    "csf_cohorts",
    [
      {
        id: FIXTURE_COHORT_ID,
        organization_id: FIXTURE_ORGANIZATION_ID,
        graduation_year: 2028,
        label: "Synthetic class of 2028",
        status: "active",
      },
    ],
    "id",
  );
  await upsertRows(
    pluginDb,
    "csf_cohort_terms",
    [
      {
        organization_id: FIXTURE_ORGANIZATION_ID,
        cohort_id: FIXTURE_COHORT_ID,
        term_id: FIXTURE_TERM_ID,
        grade_level: 11,
        sheet_tab_name: "F26",
        status: "active",
      },
    ],
    "cohort_id,term_id",
  );
  await upsertRows(pluginDb, "csf_profiles", rows.profiles, "id");
  await upsertRows(
    pluginDb,
    "csf_profile_cohort_memberships",
    rows.profileCohorts,
    "profile_id,cohort_id",
  );
  await upsertRows(
    pluginDb,
    "csf_profile_accounts",
    rows.profileAccounts,
    "organization_id,profile_id,user_id",
  );
  await upsertRows(pluginDb, "csf_staff_positions", rows.staffPositions, "id");
  await upsertRows(
    pluginDb,
    "csf_staff_view_preferences",
    rows.staffViewPreferences,
    "organization_id,user_id",
  );
  await upsertRows(pluginDb, "csf_term_applications", rows.applications, "id");
  await upsertRows(
    pluginDb,
    "csf_term_memberships",
    rows.termMemberships,
    "organization_id,profile_id,term_id",
  );
  await upsertRows(
    pluginDb,
    "csf_review_periods",
    [
      {
        id: FIXTURE_REVIEW_PERIOD_ID,
        organization_id: FIXTURE_ORGANIZATION_ID,
        term_id: FIXTURE_TERM_ID,
        kind: "membership_applications",
        status: "open",
        title: "Synthetic Fall 2026 application review",
        instructions: "Synthetic hosted load fixture.",
        opens_at: "2026-08-01T00:00:00-07:00",
        closes_at: "2026-12-25T23:59:00-08:00",
        opened_by: officerId,
        opened_at: "2026-08-01T00:00:00-07:00",
        created_by: officerId,
      },
    ],
    "id",
  );

  const cohortMemberships = await countOrganizationRows(
    pluginDb,
    "csf_profile_cohort_memberships",
  );
  const counts = {
    applications: await countOrganizationRows(
      pluginDb,
      "csf_term_applications",
    ),
    authAccounts: await countOrganizationRows(publicDb, "organization_members"),
    cohortMemberships,
    memberProfiles: cohortMemberships,
    officerPositions: await countOrganizationRows(
      pluginDb,
      "csf_staff_positions",
    ),
    profileAccounts: await countOrganizationRows(
      pluginDb,
      "csf_profile_accounts",
    ),
    profiles: await countOrganizationRows(pluginDb, "csf_profiles"),
    reviewPeriods: await countOrganizationRows(pluginDb, "csf_review_periods"),
    termMemberships: await countOrganizationRows(
      pluginDb,
      "csf_term_memberships",
    ),
  };
  const expected = {
    applications: MEMBER_PROFILE_COUNT,
    authAccounts: MEMBER_SESSION_COUNT + OFFICER_SESSION_COUNT,
    cohortMemberships: MEMBER_PROFILE_COUNT,
    memberProfiles: MEMBER_PROFILE_COUNT,
    officerPositions: OFFICER_SESSION_COUNT,
    profileAccounts: MEMBER_SESSION_COUNT + OFFICER_SESSION_COUNT,
    profiles: MEMBER_PROFILE_COUNT + OFFICER_SESSION_COUNT,
    reviewPeriods: 1,
    termMemberships: MEMBER_PROFILE_COUNT,
  };
  if (JSON.stringify(counts) !== JSON.stringify(expected)) {
    fail("The synthetic fixture row counts do not match the contract.");
  }
  return counts;
}

/**
 * @param {Record<string, string | undefined>} [environment]
 * @param {{ isolatedLocal?: boolean }} [options]
 */
export async function main(
  environment = process.env,
  { isolatedLocal = false } = {},
) {
  const target = isolatedLocal
    ? validateIsolatedProvisionTarget(environment)
    : validateProvisionTarget(environment);
  const counts = await provisionDatabase(target);
  process.stdout.write(`${JSON.stringify(counts)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const argumentsAfterScript = process.argv.slice(2);
  const isolatedLocal = argumentsAfterScript.includes("--isolated-local");
  if (
    argumentsAfterScript.some((argument) => argument !== "--isolated-local") ||
    argumentsAfterScript.filter((argument) => argument === "--isolated-local")
      .length > 1
  ) {
    process.stderr.write("Unknown fixture provisioner argument.\n");
    process.exit(1);
  }
  main(process.env, { isolatedLocal }).catch((error) => {
    process.stderr.write(
      `${error instanceof FixtureProvisionError ? error.message : "Fixture provisioning failed."}\n`,
    );
    process.exit(1);
  });
}
