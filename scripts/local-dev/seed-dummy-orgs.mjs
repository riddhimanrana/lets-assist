#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadEnv() {
  const cwd = process.cwd();
  return {
    ...readEnvFile(path.join(cwd, ".env.local")),
    ...process.env,
  };
}

async function upsertDummyUser({ url, serviceRoleKey, email, password, username, fullName }) {
  const queryRes = await fetch(`${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });

  if (!queryRes.ok) {
    throw new Error(`User lookup failed for ${email}: ${queryRes.status} ${await queryRes.text()}`);
  }

  const payload = await queryRes.json();
  const existing = Array.isArray(payload?.users)
    ? payload.users.find((u) => u?.email?.toLowerCase() === email.toLowerCase())
    : null;

  if (existing?.id) {
    const updateRes = await fetch(`${url}/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        // Don't send password to admin API - it doesn't hash correctly in local dev
        // Passwords are already set by bootstrap-auth-user.mjs
        email_confirm: true,
        user_metadata: { username, full_name: fullName, local_dummy: true },
      }),
    });

    if (!updateRes.ok) {
      throw new Error(`User update failed for ${email}: ${updateRes.status} ${await updateRes.text()}`);
    }

    return existing.id;
  }

  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, full_name: fullName, local_dummy: true },
    }),
  });

  if (!createRes.ok) {
    throw new Error(`User create failed for ${email}: ${createRes.status} ${await createRes.text()}`);
  }

  const created = await createRes.json();
  return created.id;
}

function sqlEscape(value) {
  return value.replaceAll("'", "''");
}

function sqlText(value) {
  return `'${sqlEscape(value)}'`;
}

function sqlUuid(value) {
  return `'${value}'::uuid`;
}

function sqlTimestamp(value) {
  return `'${value.toISOString()}'::timestamptz`;
}

function sqlJson(value) {
  return `'${sqlEscape(JSON.stringify(value))}'::jsonb`;
}

function offsetUtcDate(baseTime, daysOffset, hours = 9, minutes = 0) {
  const date = new Date(baseTime + daysOffset * 24 * 60 * 60 * 1000);
  date.setUTCHours(hours, minutes, 0, 0);
  return date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}

async function main() {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY in .env.local");
  }

  const users = [
    { email: env.DEV_BOOTSTRAP_EMAIL || "riddhiman.rana@gmail.com", username: "riddhimanrana", fullName: "Riddhiman Rana" },
    { email: "dummy.admin1@local.test", username: "dummy_admin1", fullName: "Dummy Admin One" },
    { email: "dummy.admin2@local.test", username: "dummy_admin2", fullName: "Dummy Admin Two" },
    { email: "dummy.staff1@local.test", username: "dummy_staff1", fullName: "Dummy Staff One" },
    { email: "dummy.staff2@local.test", username: "dummy_staff2", fullName: "Dummy Staff Two" },
    { email: "dummy.member1@local.test", username: "dummy_member1", fullName: "Dummy Member One" },
    { email: "dummy.member2@local.test", username: "dummy_member2", fullName: "Dummy Member Two" },
  ];

  const password = "DummyPass123!";
  const ids = [];

  for (const user of users) {
    const id = await upsertDummyUser({
      url: supabaseUrl,
      serviceRoleKey,
      email: user.email,
      password,
      username: user.username,
      fullName: user.fullName,
    });
    ids.push(id);
  }

  const [owner_a, owner_b, member_a, member_b, member_c] = ids;

  const regularMemberName = "Riddhiman Rana";
  const trustedReviewerName = "Dummy Admin One";
  const orgAdminName = "Dummy Admin Two";
  const minimalUserName = "Dummy Staff One";
  const alexTrustedName = "Dummy Staff Two";

  const regularMemberEmail = "riddhiman.rana@gmail.com";
  const trustedReviewerEmail = "dummy.admin1@local.test";
  const orgAdminEmail = "dummy.admin2@local.test";
  const minimalUserEmail = "dummy.staff1@local.test";
  const alexTrustedEmail = "dummy.staff2@local.test";

  const baseTime = Date.now();

  const cleanupStart = offsetUtcDate(baseTime, -36, 17);
  const cleanupEnd = addHours(cleanupStart, 3);
  const cleanupProjectCreatedAt = addDays(cleanupStart, -7);
  const cleanupIssuedAt1 = addDays(cleanupEnd, 2);
  const cleanupIssuedAt2 = addDays(cleanupEnd, 3);

  const pantryStart = offsetUtcDate(baseTime, 14, 16);
  const pantryProjectCreatedAt = addDays(pantryStart, -14);

  const readingStart = offsetUtcDate(baseTime, -210, 22);
  const readingEnd = addHours(readingStart, 2);
  const readingProjectCreatedAt = addDays(readingStart, -7);
  const readingIssuedAt1 = addDays(readingEnd, 1);
  const readingIssuedAt2 = addDays(readingEnd, 2);
  const readingIssuedAt3 = addDays(readingEnd, 4);

  const stemStart = offsetUtcDate(baseTime, 28, 18);
  const stemProjectCreatedAt = addDays(stemStart, -10);

  const acornCleanupProjectId = "33333333-3333-4333-8333-333333333331";
  const acornPantryProjectId = "33333333-3333-4333-8333-333333333332";
  const brightFutureReadingProjectId = "33333333-3333-4333-8333-333333333333";
  const brightFutureStemProjectId = "33333333-3333-4333-8333-333333333334";

  const cleanupOrgAdminSignupId = "44444444-4444-4444-8444-444444444441";
  const cleanupMinimalUserSignupId = "44444444-4444-4444-8444-444444444442";
  const readingAlexTrustedSignupId = "44444444-4444-4444-8444-444444444443";
  const readingRegularMemberSignupId = "44444444-4444-4444-8444-444444444444";
  const readingTrustedReviewerSignupId = "44444444-4444-4444-8444-444444444445";

  const cleanupOrgAdminCertificateId = "55555555-5555-4555-8555-555555555551";
  const cleanupMinimalUserCertificateId = "55555555-5555-4555-8555-555555555552";
  const readingAlexTrustedCertificateId = "55555555-5555-4555-8555-555555555553";
  const readingRegularMemberCertificateId = "55555555-5555-4555-8555-555555555554";
  const readingTrustedReviewerCertificateId = "55555555-5555-4555-8555-555555555555";

  const profileUpserts = users
    .map((u, idx) => `('${ids[idx]}'::uuid, '${sqlEscape(u.username)}', '${sqlEscape(u.fullName)}', '${sqlEscape(u.email)}')`)
    .join(",\n      ");

  const upsertProfilesSql = `
insert into public.profiles (id, username, full_name, email)
values
      ${profileUpserts}
on conflict (id) do update set
  username = excluded.username,
  full_name = excluded.full_name,
  email = excluded.email,
  updated_at = now();
`;

  const upsertOrganizationsSql = `
insert into public.organizations (id, name, username, description, website, type, join_code, verified, created_by, allowed_email_domains)
values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'Acorn Helpers Collective', 'acorn_helpers_demo', 'Demo nonprofit org for local testing of memberships, permissions, and onboarding.', 'https://example.org/acorn-helpers', 'nonprofit', 'ACORN1', true, '${ids[0]}'::uuid, 'example.org'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'Bright Future Academy', 'bright_future_demo', 'Demo school org to test volunteer flows and organization dashboards.', 'https://example.org/bright-future', 'school', 'BRGHT2', true, '${ids[1]}'::uuid, 'school.org')
on conflict (id) do update set
  name = excluded.name,
  username = excluded.username,
  description = excluded.description,
  website = excluded.website,
  type = excluded.type,
  join_code = excluded.join_code,
  verified = excluded.verified,
  created_by = excluded.created_by,
  allowed_email_domains = excluded.allowed_email_domains;
`;

  const upsertMembersSql = `
insert into public.organization_members (id, organization_id, user_id, role, status, can_verify_hours, is_visible, joined_at, last_activity_at)
values
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111'::uuid, '${ids[0]}'::uuid, 'admin', 'active', true, true, now(), now()),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111'::uuid, '${ids[3]}'::uuid, 'staff', 'active', true, true, now(), now()),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111'::uuid, '${ids[5]}'::uuid, 'member', 'active', false, true, now(), now()),
  (gen_random_uuid(), '22222222-2222-4222-8222-222222222222'::uuid, '${ids[1]}'::uuid, 'admin', 'active', true, true, now(), now()),
  (gen_random_uuid(), '22222222-2222-4222-8222-222222222222'::uuid, '${ids[4]}'::uuid, 'staff', 'active', true, true, now(), now()),
  (gen_random_uuid(), '22222222-2222-4222-8222-222222222222'::uuid, '${ids[6]}'::uuid, 'member', 'active', false, true, now(), now())
on conflict (organization_id, user_id) do update set
  role = excluded.role,
  status = excluded.status,
  can_verify_hours = excluded.can_verify_hours,
  is_visible = excluded.is_visible,
  last_activity_at = excluded.last_activity_at;
`;

  const upsertProjectsSql = `
insert into public.projects (
  id,
  creator_id,
  organization_id,
  title,
  location,
  location_data,
  description,
  event_type,
  verification_method,
  schedule,
  status,
  visibility,
  workflow_status,
  project_timezone,
  require_login,
  restrict_to_org_domains,
  published,
  created_at
)
values
  (
    ${sqlUuid(acornCleanupProjectId)},
    ${sqlUuid(owner_a)},
    ${sqlUuid('11111111-1111-4111-8111-111111111111')},
    ${sqlText('Acorn Community Cleanup')},
    ${sqlText('Riverside Park, Downtown')},
    ${sqlJson({ text: 'Riverside Park, Downtown', display_name: 'Riverside Park, Downtown' })},
    ${sqlText('Neighborhood cleanup day for families, volunteers, and students.')},
    ${sqlText('oneTime')},
    ${sqlText('qr-code')},
    ${sqlJson({ oneTime: { date: dateOnly(cleanupStart), startTime: '10:00', endTime: '13:00', volunteers: 24 } })},
    ${sqlText('completed')},
    ${sqlText('organization_only')},
    ${sqlText('published')},
    ${sqlText('America/Los_Angeles')},
    true,
    true,
    ${sqlJson({ oneTime: true })},
    ${sqlTimestamp(cleanupProjectCreatedAt)}
  ),
  (
    ${sqlUuid(acornPantryProjectId)},
    ${sqlUuid(member_a)},
    ${sqlUuid('11111111-1111-4111-8111-111111111111')},
    ${sqlText('Acorn Pantry Sorting Night')},
    ${sqlText('Acorn Community Center')},
    ${sqlJson({ text: 'Acorn Community Center', display_name: 'Acorn Community Center' })},
    ${sqlText('Evening pantry organization shift for donation preparation and shelf labeling.')},
    ${sqlText('oneTime')},
    ${sqlText('manual')},
    ${sqlJson({ oneTime: { date: dateOnly(pantryStart), startTime: '15:00', endTime: '19:00', volunteers: 18 } })},
    ${sqlText('upcoming')},
    ${sqlText('public')},
    ${sqlText('published')},
    ${sqlText('America/Los_Angeles')},
    true,
    false,
    ${sqlJson({})},
    ${sqlTimestamp(pantryProjectCreatedAt)}
  ),
  (
    ${sqlUuid(brightFutureReadingProjectId)},
    ${sqlUuid(owner_b)},
    ${sqlUuid('22222222-2222-4222-8222-222222222222')},
    ${sqlText('Bright Future Reading Buddies')},
    ${sqlText('Bright Future Elementary Library')},
    ${sqlJson({ text: 'Bright Future Elementary Library', display_name: 'Bright Future Elementary Library' })},
    ${sqlText('After-school reading program with younger students and shared literacy activities.')},
    ${sqlText('oneTime')},
    ${sqlText('auto')},
    ${sqlJson({ oneTime: { date: dateOnly(readingStart), startTime: '14:00', endTime: '16:00', volunteers: 12 } })},
    ${sqlText('completed')},
    ${sqlText('public')},
    ${sqlText('published')},
    ${sqlText('America/Los_Angeles')},
    true,
    false,
    ${sqlJson({ oneTime: true })},
    ${sqlTimestamp(readingProjectCreatedAt)}
  ),
  (
    ${sqlUuid(brightFutureStemProjectId)},
    ${sqlUuid(member_c)},
    ${sqlUuid('22222222-2222-4222-8222-222222222222')},
    ${sqlText('Bright Future STEM Garden Sprint')},
    ${sqlText('Bright Future Campus Garden')},
    ${sqlJson({ text: 'Bright Future Campus Garden', display_name: 'Bright Future Campus Garden' })},
    ${sqlText('Hands-on campus garden build and maintenance project for student volunteers.')},
    ${sqlText('oneTime')},
    ${sqlText('signup-only')},
    ${sqlJson({ oneTime: { date: dateOnly(stemStart), startTime: '11:00', endTime: '14:00', volunteers: 20 } })},
    ${sqlText('upcoming')},
    ${sqlText('organization_only')},
    ${sqlText('published')},
    ${sqlText('America/Los_Angeles')},
    true,
    true,
    ${sqlJson({})},
    ${sqlTimestamp(stemProjectCreatedAt)}
  )
on conflict (id) do update set
  creator_id = excluded.creator_id,
  organization_id = excluded.organization_id,
  title = excluded.title,
  location = excluded.location,
  location_data = excluded.location_data,
  description = excluded.description,
  event_type = excluded.event_type,
  verification_method = excluded.verification_method,
  schedule = excluded.schedule,
  status = excluded.status,
  visibility = excluded.visibility,
  workflow_status = excluded.workflow_status,
  project_timezone = excluded.project_timezone,
  require_login = excluded.require_login,
  restrict_to_org_domains = excluded.restrict_to_org_domains,
  published = excluded.published,
  created_at = excluded.created_at;
`;

  const upsertSignupsSql = `
insert into public.project_signups (
  id,
  project_id,
  user_id,
  schedule_id,
  status,
  created_at,
  check_in_time,
  check_out_time,
  volunteer_comment
)
values
  (
    ${sqlUuid(cleanupOrgAdminSignupId)},
    ${sqlUuid(acornCleanupProjectId)},
    ${sqlUuid(member_a)},
    ${sqlText('oneTime')},
    ${sqlText('attended')},
    ${sqlTimestamp(addDays(cleanupStart, -1))},
    ${sqlTimestamp(addMinutes(cleanupStart, 10))},
    ${sqlTimestamp(addMinutes(cleanupEnd, -5))},
    ${sqlText('Helped organize supplies and led a cleanup crew along the north trail.')}
  ),
  (
    ${sqlUuid(cleanupMinimalUserSignupId)},
    ${sqlUuid(acornCleanupProjectId)},
    ${sqlUuid(member_b)},
    ${sqlText('oneTime')},
    ${sqlText('attended')},
    ${sqlTimestamp(addDays(cleanupStart, -1))},
    ${sqlTimestamp(addMinutes(cleanupStart, 12))},
    ${sqlTimestamp(addMinutes(cleanupEnd, -2))},
    ${sqlText('Sorted bags and picked up litter near the park entrance.')}
  ),
  (
    ${sqlUuid(readingAlexTrustedSignupId)},
    ${sqlUuid(brightFutureReadingProjectId)},
    ${sqlUuid(member_c)},
    ${sqlText('oneTime')},
    ${sqlText('attended')},
    ${sqlTimestamp(addDays(readingStart, -1))},
    ${sqlTimestamp(addMinutes(readingStart, 15))},
    ${sqlTimestamp(addMinutes(readingEnd, -3))},
    ${sqlText('Read with first-grade students and helped keep the room organized.')}
  ),
  (
    ${sqlUuid(readingRegularMemberSignupId)},
    ${sqlUuid(brightFutureReadingProjectId)},
    ${sqlUuid(owner_a)},
    ${sqlText('oneTime')},
    ${sqlText('attended')},
    ${sqlTimestamp(addDays(readingStart, -1))},
    ${sqlTimestamp(addMinutes(readingStart, 20))},
    ${sqlTimestamp(addMinutes(readingEnd, -1))},
    ${sqlText('Led paired reading practice and checked in supplies.')}
  ),
  (
    ${sqlUuid(readingTrustedReviewerSignupId)},
    ${sqlUuid(brightFutureReadingProjectId)},
    ${sqlUuid(owner_b)},
    ${sqlText('oneTime')},
    ${sqlText('attended')},
    ${sqlTimestamp(addDays(readingStart, -1))},
    ${sqlTimestamp(addMinutes(readingStart, 25))},
    ${sqlTimestamp(addMinutes(readingEnd, -4))},
    ${sqlText('Coordinated reading groups and tracked volunteer attendance.')}
  )
on conflict (id) do update set
  project_id = excluded.project_id,
  user_id = excluded.user_id,
  schedule_id = excluded.schedule_id,
  status = excluded.status,
  created_at = excluded.created_at,
  check_in_time = excluded.check_in_time,
  check_out_time = excluded.check_out_time,
  volunteer_comment = excluded.volunteer_comment;
`;

  const upsertCertificatesSql = `
insert into public.certificates (
  id,
  project_title,
  creator_name,
  is_certified,
  event_start,
  event_end,
  volunteer_email,
  user_id,
  check_in_method,
  created_at,
  organization_name,
  project_id,
  schedule_id,
  issued_at,
  signup_id,
  volunteer_name,
  project_location,
  creator_id,
  type,
  description
)
values
  (
    ${sqlUuid(cleanupOrgAdminCertificateId)},
    ${sqlText('Acorn Community Cleanup')},
    ${sqlText(regularMemberName)},
    true,
    ${sqlTimestamp(cleanupStart)},
    ${sqlTimestamp(cleanupEnd)},
    ${sqlText(orgAdminEmail)},
    ${sqlUuid(member_a)},
    ${sqlText('qr-code')},
    ${sqlTimestamp(cleanupIssuedAt1)},
    ${sqlText('Acorn Helpers Collective')},
    ${sqlUuid(acornCleanupProjectId)},
    ${sqlText('oneTime')},
    ${sqlTimestamp(cleanupIssuedAt1)},
    ${sqlUuid(cleanupOrgAdminSignupId)},
    ${sqlText(orgAdminName)},
    ${sqlText('Riverside Park, Downtown')},
    ${sqlUuid(owner_a)},
    ${sqlText('verified')},
    ${sqlText('Completed cleanup shift and verified attendance.')}
  ),
  (
    ${sqlUuid(cleanupMinimalUserCertificateId)},
    ${sqlText('Acorn Community Cleanup')},
    ${sqlText(regularMemberName)},
    true,
    ${sqlTimestamp(cleanupStart)},
    ${sqlTimestamp(cleanupEnd)},
    ${sqlText(minimalUserEmail)},
    ${sqlUuid(member_b)},
    ${sqlText('qr-code')},
    ${sqlTimestamp(cleanupIssuedAt2)},
    ${sqlText('Acorn Helpers Collective')},
    ${sqlUuid(acornCleanupProjectId)},
    ${sqlText('oneTime')},
    ${sqlTimestamp(cleanupIssuedAt2)},
    ${sqlUuid(cleanupMinimalUserSignupId)},
    ${sqlText(minimalUserName)},
    ${sqlText('Riverside Park, Downtown')},
    ${sqlUuid(owner_a)},
    ${sqlText('verified')},
    ${sqlText('Completed cleanup shift and verified attendance.')}
  ),
  (
    ${sqlUuid(readingAlexTrustedCertificateId)},
    ${sqlText('Bright Future Reading Buddies')},
    ${sqlText(trustedReviewerName)},
    true,
    ${sqlTimestamp(readingStart)},
    ${sqlTimestamp(readingEnd)},
    ${sqlText(alexTrustedEmail)},
    ${sqlUuid(member_c)},
    ${sqlText('auto')},
    ${sqlTimestamp(readingIssuedAt1)},
    ${sqlText('Bright Future Academy')},
    ${sqlUuid(brightFutureReadingProjectId)},
    ${sqlText('oneTime')},
    ${sqlTimestamp(readingIssuedAt1)},
    ${sqlUuid(readingAlexTrustedSignupId)},
    ${sqlText(alexTrustedName)},
    ${sqlText('Bright Future Elementary Library')},
    ${sqlUuid(owner_b)},
    ${sqlText('verified')},
    ${sqlText('Completed reading buddies session and helped younger students practice reading.')}
  ),
  (
    ${sqlUuid(readingRegularMemberCertificateId)},
    ${sqlText('Bright Future Reading Buddies')},
    ${sqlText(trustedReviewerName)},
    true,
    ${sqlTimestamp(readingStart)},
    ${sqlTimestamp(readingEnd)},
    ${sqlText(regularMemberEmail)},
    ${sqlUuid(owner_a)},
    ${sqlText('auto')},
    ${sqlTimestamp(readingIssuedAt2)},
    ${sqlText('Bright Future Academy')},
    ${sqlUuid(brightFutureReadingProjectId)},
    ${sqlText('oneTime')},
    ${sqlTimestamp(readingIssuedAt2)},
    ${sqlUuid(readingRegularMemberSignupId)},
    ${sqlText(regularMemberName)},
    ${sqlText('Bright Future Elementary Library')},
    ${sqlUuid(owner_b)},
    ${sqlText('verified')},
    ${sqlText('Completed reading buddies session and assisted with book sorting.')}
  ),
  (
    ${sqlUuid(readingTrustedReviewerCertificateId)},
    ${sqlText('Bright Future Reading Buddies')},
    ${sqlText(trustedReviewerName)},
    true,
    ${sqlTimestamp(readingStart)},
    ${sqlTimestamp(readingEnd)},
    ${sqlText(trustedReviewerEmail)},
    ${sqlUuid(owner_b)},
    ${sqlText('auto')},
    ${sqlTimestamp(readingIssuedAt3)},
    ${sqlText('Bright Future Academy')},
    ${sqlUuid(brightFutureReadingProjectId)},
    ${sqlText('oneTime')},
    ${sqlTimestamp(readingIssuedAt3)},
    ${sqlUuid(readingTrustedReviewerSignupId)},
    ${sqlText(trustedReviewerName)},
    ${sqlText('Bright Future Elementary Library')},
    ${sqlUuid(owner_b)},
    ${sqlText('verified')},
    ${sqlText('Completed reading buddies session and coordinated the volunteer team.')}
  )
on conflict (id) do update set
  project_title = excluded.project_title,
  creator_name = excluded.creator_name,
  is_certified = excluded.is_certified,
  event_start = excluded.event_start,
  event_end = excluded.event_end,
  volunteer_email = excluded.volunteer_email,
  user_id = excluded.user_id,
  check_in_method = excluded.check_in_method,
  created_at = excluded.created_at,
  organization_name = excluded.organization_name,
  project_id = excluded.project_id,
  schedule_id = excluded.schedule_id,
  issued_at = excluded.issued_at,
  signup_id = excluded.signup_id,
  volunteer_name = excluded.volunteer_name,
  project_location = excluded.project_location,
  creator_id = excluded.creator_id,
  type = excluded.type,
  description = excluded.description;
`;

  for (const sql of [upsertProfilesSql, upsertOrganizationsSql, upsertMembersSql, upsertProjectsSql, upsertSignupsSql, upsertCertificatesSql]) {
    execFileSync("supabase", ["db", "query", "--local", sql], {
      stdio: "inherit",
      cwd: process.cwd(),
    });
  }

  console.log("[seed-dummy-orgs] Seeded 2 organizations, 4 projects, 5 signups, and 5 certificates.");
}

main().catch((error) => {
  console.error("[seed-dummy-orgs]", error.message);
  process.exit(1);
});
