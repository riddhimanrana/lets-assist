import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { readProjectActionSource } from "@/tests/support/project-action-source";

import { resolveServerCheckoutTime } from "./checkout";

const NOW = new Date("2026-07-11T20:00:00.000Z");

test("participant checkout uses the supplied server clock", () => {
  assert.deepEqual(resolveServerCheckoutTime("2026-07-11T18:00:00.000Z", NOW), {
    ok: true,
    checkOutTime: NOW.toISOString(),
  });
});

test("participant checkout rejects missing, malformed, and future check-ins", () => {
  assert.deepEqual(resolveServerCheckoutTime(null, NOW), {
    ok: false,
    reason: "missing_check_in",
  });
  assert.deepEqual(resolveServerCheckoutTime("not-a-date", NOW), {
    ok: false,
    reason: "invalid_check_in",
  });
  assert.deepEqual(resolveServerCheckoutTime("2026-07-11T21:00:00.000Z", NOW), {
    ok: false,
    reason: "check_in_in_future",
  });
});

test("participant and organizer checkout paths enforce separate ownership boundaries", () => {
  const participantActions = readFileSync(
    join(process.cwd(), "app/attend/[projectId]/actions.ts"),
    "utf8",
  );
  const organizerActions = readProjectActionSource();
  const organizerClient = readFileSync(
    join(process.cwd(), "app/projects/[id]/attendance/AttendanceClient.tsx"),
    "utf8",
  );

  assert.doesNotMatch(participantActions, /overrideTime/u);
  assert.match(participantActions, /\.eq\("user_id", authenticatedUserId\)/u);
  assert.match(participantActions, /verifyAttendanceCheckoutCapability/u);
  assert.match(participantActions, /complete_participant_checkout/u);
  assert.doesNotMatch(participantActions, /\.update\(\{\s*check_out_time:/u);
  assert.match(organizerActions, /export async function checkOutParticipant/u);
  assert.match(
    organizerActions,
    /canUserManageProject\(supabase, project, user\.id\)/u,
  );
  assert.match(organizerClient, /checkOutParticipant\(signupId\)/u);
  assert.doesNotMatch(organizerClient, /checkOutUser/u);
});

test("database checkout is row-locked, one-shot, and bounded by the event window", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260712021055_atomic_attendance_checkout_and_signup_capacity.sql",
    ),
    "utf8",
  );

  assert.match(migration, /complete_participant_checkout/u);
  assert.match(migration, /FOR UPDATE/u);
  assert.match(migration, /signups\.check_out_time IS NULL/u);
  assert.match(migration, /LEAST\(v_now, v_window\.ends_at\)/u);
  assert.match(migration, /outcome := 'already_checked_out'/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.complete_participant_checkout[\s\S]*FROM PUBLIC, anon, authenticated/u,
  );
  assert.match(migration, /protect_participant_checkout_time/u);
  assert.match(migration, /protect_project_signup_client_mutation/u);
  assert.match(
    migration,
    /NEW\.project_id IS DISTINCT FROM OLD\.project_id[\s\S]*NEW\.anonymous_id IS DISTINCT FROM OLD\.anonymous_id/u,
  );
  assert.match(migration, /participants may only cancel their own signup/u);
  assert.match(migration, /OLD\.status IN \('pending', 'approved'\)/u);
  assert.match(
    migration,
    /REVOKE DELETE ON TABLE public\.project_signups FROM anon, authenticated/u,
  );
});

test("verified registered check-in crosses the client boundary through the server role", () => {
  const participantActions = readFileSync(
    join(process.cwd(), "app/attend/[projectId]/actions.ts"),
    "utf8",
  );

  assert.match(
    participantActions,
    /const serviceSupabase = getAdminClient\(\);[\s\S]*\.eq\(["']user_id["'], user\.id\)[\s\S]*\.is\(["']check_in_time["'], null\)/u,
  );
  assert.match(
    participantActions,
    /requireAttendancePresence\([\s\S]*signup\.project_id,[\s\S]*signup\.schedule_id/u,
  );
});

test("signup creation and anonymous confirmation use the capacity lock", () => {
  const signupActions = readProjectActionSource();
  const confirmationPage = readFileSync(
    join(process.cwd(), "app/anonymous/[id]/confirm/page.tsx"),
    "utf8",
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260712021055_atomic_attendance_checkout_and_signup_capacity.sql",
    ),
    "utf8",
  );

  assert.match(signupActions, /insert_project_signup_with_capacity/u);
  assert.doesNotMatch(
    signupActions,
    /\.from\(["']project_signups["']\)[\s\S]{0,120}\.insert\(/u,
  );
  assert.match(confirmationPage, /confirmAnonymousSignupWithCapacity/u);
  assert.match(migration, /pg_advisory_xact_lock/u);
  assert.match(
    migration,
    /FROM public\.anonymous_signups AS anonymous[\s\S]*FOR UPDATE/u,
  );
  assert.match(migration, /confirm_anonymous_signup_with_capacity/u);
  assert.match(
    migration,
    /REVOKE INSERT ON TABLE public\.project_signups FROM anon, authenticated/u,
  );
});
