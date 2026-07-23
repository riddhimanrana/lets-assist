#!/usr/bin/env node

import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { getLocalSupabaseEnv } from "./dv-local-env.mjs";

const password = process.env.DV_LOCAL_TEST_PASSWORD?.trim();
if (!password) {
  throw new Error("Set DV_LOCAL_TEST_PASSWORD to the run-scoped fixture password.");
}

const { url, anonKey, serviceRoleKey } = getLocalSupabaseEnv();

async function clientFor(email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function rows(label, query) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

const authenticatedClients = await Promise.all([
  clientFor("dv.student.a@local.test"),
  clientFor("dv.outsider@local.test"),
  clientFor("dv.staff@local.test"),
]);
const anon = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const [label, client] of [
  ["student", authenticatedClients[0]],
  ["outsider", authenticatedClients[1]],
  ["staff", authenticatedClients[2]],
  ["anonymous", anon],
]) {
  const result = await client
    .schema("plugin_data")
    .from("dv_sd_seasonal_memberships")
    .select("id")
    .limit(1);
  assert.ok(result.error, `${label} unexpectedly received direct plugin_data access`);
  assert.match(
    result.error.message,
    /permission denied for schema plugin_data|invalid schema/u,
    `${label} failed for an unexpected reason`,
  );
}

const maintenance = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
}).schema("plugin_data");

const memberships = await rows(
  "service seasonal memberships",
  maintenance.from("dv_sd_seasonal_memberships").select("id,status,organization_id"),
);
assert.equal(memberships.length, 4, "deterministic seasonal memberships are missing");

const households = await rows(
  "service households",
  maintenance.from("dv_sd_households").select("id,display_name,organization_id"),
);
assert.equal(households.length, 2, "deterministic households are missing");

const guardians = await rows(
  "service guardians",
  maintenance.from("dv_sd_guardians").select("id,organization_id"),
);
assert.equal(guardians.length, 2, "deterministic guardians are missing");

const staffLedger = await rows(
  "service-credit ledger",
  maintenance.from("dv_sd_family_service_ledger").select("id,credits").limit(1),
);
assert.equal(staffLedger.length, 1, "deterministic service ledger is missing");

const triggerProtectedUpdate = await maintenance
  .from("dv_sd_family_service_ledger")
  .update({ credits: 99 })
  .eq("id", staffLedger[0].id);
assert.ok(triggerProtectedUpdate.error, "immutable trigger also blocks maintenance updates");

console.log("DV database fixtures and server-only plugin_data checks passed.");
