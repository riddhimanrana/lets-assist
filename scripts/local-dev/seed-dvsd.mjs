#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { getLocalSupabaseEnv } from "./dv-local-env.mjs";

const password = process.env.DV_LOCAL_TEST_PASSWORD;
if (!password) {
  throw new Error("Set DV_LOCAL_TEST_PASSWORD before seeding local DV fixtures.");
}

const IDS = {
  organization: "d0000000-0000-4000-8000-000000000001",
  currentSeason: "d0000000-0000-4000-8000-000000000010",
  priorSeason: "d0000000-0000-4000-8000-000000000011",
  project: "d0000000-0000-4000-8000-000000000020",
  tournament: "d0000000-0000-4000-8000-000000000021",
  household: "d0000000-0000-4000-8000-000000000030",
  secondHousehold: "d0000000-0000-4000-8000-000000000031",
  guardian: "d0000000-0000-4000-8000-000000000040",
  secondGuardian: "d0000000-0000-4000-8000-000000000041",
};

const accounts = [
  { key: "admin", email: "dv.admin@local.test", fullName: "DV Admin", role: "admin" },
  { key: "staff", email: "dv.staff@local.test", fullName: "DV Staff", role: "staff" },
  { key: "studentA", email: "dv.student.a@local.test", fullName: "Alex Student", role: "member" },
  { key: "studentB", email: "dv.student.b@local.test", fullName: "Blair Student", role: "member" },
  { key: "studentC", email: "dv.student.c@local.test", fullName: "Casey Student", role: "member" },
  { key: "outsider", email: "dv.outsider@local.test", fullName: "Outside User", role: null },
];

async function upsertAuthUser(admin, account) {
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;

  const existing = listed.users.find(
    (user) => user.email?.toLowerCase() === account.email,
  );
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        full_name: account.fullName,
        username: account.email.split("@")[0].replaceAll(".", "-"),
        local_fixture: true,
      },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: account.fullName,
      username: account.email.split("@")[0].replaceAll(".", "-"),
      local_fixture: true,
    },
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
  const plugin = admin.schema("plugin_data");
  const users = {};

  for (const account of accounts) {
    users[account.key] = await upsertAuthUser(admin, account);
  }

  await must("organization", admin.from("organizations").upsert({
    id: IDS.organization,
    name: "DV Speech & Debate Local",
    username: "dv-speech-debate-local",
    type: "school",
    description: "Deterministic local fixture organization.",
    join_code: "DVLOC1",
    created_by: users.admin.id,
  }));

  await must(
    "members",
    admin.from("organization_members").upsert(
      accounts
        .filter((account) => account.role)
        .map((account) => ({
          organization_id: IDS.organization,
          user_id: users[account.key].id,
          role: account.role,
          status: "active",
        })),
      { onConflict: "organization_id,user_id" },
    ),
  );

  await must("entitlement", admin.from("organization_plugin_entitlements").upsert({
    organization_id: IDS.organization,
    plugin_key: "dv-speech-debate",
    status: "active",
    is_forced: true,
    created_by: users.admin.id,
  }, { onConflict: "organization_id,plugin_key" }));

  await must("install", admin.from("organization_plugin_installs").upsert({
    organization_id: IDS.organization,
    plugin_key: "dv-speech-debate",
    enabled: true,
    installed_version: "2.0.0",
    installed_by: users.admin.id,
    configuration: {
      default_entries_per_judge: 2,
      family_service_required_credits: 2,
      external_integration_mode: "fixture",
    },
  }, { onConflict: "organization_id,plugin_key" }));

  await must("seasons", plugin.from("org_seasons").upsert([
    {
      id: IDS.priorSeason,
      organization_id: IDS.organization,
      label: "2025-2026",
      starts_at: "2025-08-01",
      ends_at: "2026-06-15",
      is_current: false,
    },
    {
      id: IDS.currentSeason,
      organization_id: IDS.organization,
      label: "2026-2027",
      starts_at: "2026-08-01",
      ends_at: "2027-06-15",
      is_current: true,
    },
  ], { onConflict: "organization_id,label" }));

  const schedule = {
    start: "2026-11-14T16:00:00.000Z",
    end: "2026-11-15T01:00:00.000Z",
    slots: [],
  };
  await must("project", admin.from("projects").upsert({
    id: IDS.project,
    creator_id: users.admin.id,
    organization_id: IDS.organization,
    title: "Local Invitational",
    location: "DVHS",
    description: "Fixture tournament with a deliberate judge shortage.",
    event_type: "event",
    verification_method: "manual",
    schedule,
    status: "upcoming",
    visibility: "organization_only",
    require_login: true,
  }));

  await must("tournament", plugin.from("dv_sd_tournaments").upsert({
    id: IDS.tournament,
    organization_id: IDS.organization,
    project_id: IDS.project,
    season_id: IDS.currentSeason,
    name: "Local Invitational",
    location: "DVHS",
    format: "mixed",
    status: "registration_open",
    starts_at: "2026-11-14T16:00:00.000Z",
    ends_at: "2026-11-15T01:00:00.000Z",
    registration_deadline: "2026-11-01T07:00:00.000Z",
    entries_per_judge: 2,
    created_by: users.admin.id,
  }));

  const studentRows = await must(
    "students",
    plugin.from("dv_sd_students").upsert([
      {
        organization_id: IDS.organization,
        user_id: users.studentA.id,
        legal_name: "Alex Student",
        school_email: accounts[2].email,
        graduation_year: 2027,
      },
      {
        organization_id: IDS.organization,
        user_id: users.studentB.id,
        legal_name: "Blair Student",
        school_email: accounts[3].email,
        graduation_year: 2028,
      },
      {
        organization_id: IDS.organization,
        user_id: users.studentC.id,
        legal_name: "Casey Student",
        school_email: accounts[4].email,
        graduation_year: 2029,
      },
    ], { onConflict: "organization_id,user_id" }).select("id,user_id"),
  );
  const studentByUser = Object.fromEntries(studentRows.map((row) => [row.user_id, row.id]));

  await must("households", plugin.from("dv_sd_households").upsert([
    { id: IDS.household, organization_id: IDS.organization, display_name: "Student Household" },
    { id: IDS.secondHousehold, organization_id: IDS.organization, display_name: "Casey Household" },
  ]));

  await must("guardians", plugin.from("dv_sd_guardians").upsert([
    {
      id: IDS.guardian,
      organization_id: IDS.organization,
      normalized_email: "guardian.shared@local.test",
      email: "guardian.shared@local.test",
      full_name: "Shared Guardian",
      phone: "9255550100",
    },
    {
      id: IDS.secondGuardian,
      organization_id: IDS.organization,
      normalized_email: "guardian.casey@local.test",
      email: "guardian.casey@local.test",
      full_name: "Casey Guardian",
      phone: "9255550101",
    },
  ], { onConflict: "organization_id,normalized_email" }));

  await must("household students", plugin.from("dv_sd_household_students").upsert([
    { household_id: IDS.household, student_id: studentByUser[users.studentA.id] },
    { household_id: IDS.household, student_id: studentByUser[users.studentB.id] },
    { household_id: IDS.secondHousehold, student_id: studentByUser[users.studentC.id] },
  ]));
  await must("household guardians", plugin.from("dv_sd_household_guardians").upsert([
    { household_id: IDS.household, guardian_id: IDS.guardian, is_primary_contact: true },
    { household_id: IDS.secondHousehold, guardian_id: IDS.secondGuardian, is_primary_contact: true },
  ]));

  const memberships = await must(
    "memberships",
    plugin.from("dv_sd_seasonal_memberships").upsert([
      {
        organization_id: IDS.organization,
        season_id: IDS.priorSeason,
        student_id: studentByUser[users.studentA.id],
        household_id: IDS.household,
        status: "expired",
        application_data: { fixture: true },
      },
      {
        organization_id: IDS.organization,
        season_id: IDS.currentSeason,
        student_id: studentByUser[users.studentA.id],
        household_id: IDS.household,
        status: "approved",
        application_data: { fixture: true },
        reviewed_by: users.admin.id,
        reviewed_at: new Date().toISOString(),
      },
      {
        organization_id: IDS.organization,
        season_id: IDS.currentSeason,
        student_id: studentByUser[users.studentB.id],
        household_id: IDS.household,
        status: "submitted",
        application_data: { fixture: true },
        submitted_at: new Date().toISOString(),
      },
      {
        organization_id: IDS.organization,
        season_id: IDS.currentSeason,
        student_id: studentByUser[users.studentC.id],
        household_id: IDS.secondHousehold,
        status: "needs_action",
        application_data: { fixture: true },
        submitted_at: new Date().toISOString(),
      },
    ], { onConflict: "organization_id,season_id,student_id" }).select("id,student_id,season_id"),
  );
  const currentMembershipByStudent = Object.fromEntries(
    memberships
      .filter((row) => row.season_id === IDS.currentSeason)
      .map((row) => [row.student_id, row.id]),
  );

  await must("requirements", plugin.from("dv_sd_membership_requirements").upsert([
    {
      membership_id: currentMembershipByStudent[studentByUser[users.studentA.id]],
      requirement_type: "staff_review",
      status: "verified",
      metadata: {},
      verified_by: users.admin.id,
      verified_at: new Date().toISOString(),
    },
    {
      membership_id: currentMembershipByStudent[studentByUser[users.studentC.id]],
      requirement_type: "receipt",
      status: "rejected",
      metadata: { reason: "Unreadable fixture" },
    },
  ], { onConflict: "membership_id,requirement_type" }));

  const serviceAccounts = await must(
    "service accounts",
    plugin.from("dv_sd_family_service_accounts").upsert([
      {
        organization_id: IDS.organization,
        season_id: IDS.currentSeason,
        household_id: IDS.household,
        required_credits: 2,
      },
      {
        organization_id: IDS.organization,
        season_id: IDS.currentSeason,
        household_id: IDS.secondHousehold,
        required_credits: 2,
      },
    ], { onConflict: "organization_id,season_id,household_id" }).select("id,household_id"),
  );

  const approvedMembershipId =
    currentMembershipByStudent[studentByUser[users.studentA.id]];
  const registration = await must(
    "registration",
    plugin.from("dv_sd_tournament_registrations").upsert({
      organization_id: IDS.organization,
      tournament_id: IDS.tournament,
      membership_id: approvedMembershipId,
      status: "approved",
      permission_status: "verified",
      payment_status: "not_required",
      guardian_commitment_status: "confirmed",
      submitted_at: new Date().toISOString(),
      reviewed_by: users.admin.id,
      reviewed_at: new Date().toISOString(),
    }, { onConflict: "tournament_id,membership_id" }).select("id").single(),
  );

  await must("entry", plugin.from("dv_sd_registration_entries").upsert({
    registration_id: registration.id,
    event_code: "PF-V",
    event_name: "Public Forum",
    division: "Varsity",
    partner_student_id: studentByUser[users.studentB.id],
  }, { onConflict: "registration_id,event_code" }));

  const judge = await must("judge", plugin.from("dv_sd_judges").upsert({
    organization_id: IDS.organization,
    guardian_id: IDS.guardian,
    clearance_status: "verified",
    training_status: "verified",
    tabroom_account_status: "linked",
    event_qualifications: ["PF"],
    event_preferences: ["PF"],
    max_rounds_per_day: 3,
  }, { onConflict: "organization_id,guardian_id" }).select("id").single());

  await must("judge availability", plugin.from("dv_sd_judge_availability").upsert({
    organization_id: IDS.organization,
    tournament_id: IDS.tournament,
    judge_id: judge.id,
    status: "unknown",
    available_rounds: [],
    unavailable_rounds: [],
  }, { onConflict: "tournament_id,judge_id" }));

  const account = serviceAccounts.find((row) => row.household_id === IDS.household);
  const { count } = await plugin
    .from("dv_sd_family_service_ledger")
    .select("id", { count: "exact", head: true })
    .eq("account_id", account.id)
    .eq("source_type", "fixture");
  if (!count) {
    await must("service ledger", plugin.from("dv_sd_family_service_ledger").insert({
      account_id: account.id,
      entry_type: "earned",
      credits: 1,
      source_type: "fixture",
      note: "Prior fixture judging completion.",
      created_by: users.admin.id,
    }));
  }

  console.log(JSON.stringify({
    organizationId: IDS.organization,
    tournamentId: IDS.tournament,
    accounts: Object.fromEntries(accounts.map((account) => [
      account.key,
      { email: account.email, userId: users[account.key].id },
    ])),
  }, null, 2));
}

await main();
