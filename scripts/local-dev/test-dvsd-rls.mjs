#!/usr/bin/env node

import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getLocalSupabaseEnv } from "./dv-local-env.mjs";

const password = process.env.DV_LOCAL_TEST_PASSWORD;
if (!password) {
  throw new Error("Set DV_LOCAL_TEST_PASSWORD before running DV database tests.");
}

const { url, anonKey } = getLocalSupabaseEnv();

async function clientFor(email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client.schema("plugin_data");
}

async function rows(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

const student = await clientFor("dv.student.a@local.test");
const outsider = await clientFor("dv.outsider@local.test");
const staff = await clientFor("dv.staff@local.test");

const ownMemberships = await rows(
  "student memberships",
  student.from("dv_sd_seasonal_memberships").select("status,season_id"),
);
assert.equal(ownMemberships.length, 2, "student sees own current and prior seasons only");
assert.deepEqual(
  new Set(ownMemberships.map((row) => row.status)),
  new Set(["approved", "expired"]),
);

const studentHouseholds = await rows(
  "student household",
  student.from("dv_sd_households").select("display_name"),
);
assert.deepEqual(studentHouseholds.map((row) => row.display_name), ["Student Household"]);

const guardians = await rows(
  "student guardians",
  student.from("dv_sd_guardians").select("normalized_email"),
);
assert.deepEqual(
  guardians.map((row) => row.normalized_email),
  ["guardian.shared@local.test"],
);

const outsiderMemberships = await rows(
  "outsider memberships",
  outsider.from("dv_sd_seasonal_memberships").select("id"),
);
assert.equal(outsiderMemberships.length, 0, "non-member cannot read DV memberships");

const staffMemberships = await rows(
  "staff memberships",
  staff.from("dv_sd_seasonal_memberships").select("status"),
);
assert.equal(staffMemberships.length, 4, "staff sees all organization memberships");

const staffGuardians = await rows(
  "staff guardians",
  staff.from("dv_sd_guardians").select("id"),
);
assert.equal(staffGuardians.length, 2, "staff sees all organization guardians");

const studentAudit = await rows(
  "student audit",
  student.from("dv_sd_audit_events").select("id"),
);
assert.equal(studentAudit.length, 0, "students cannot read staff audit events");

console.log("DV database fixtures and RLS checks passed.");
