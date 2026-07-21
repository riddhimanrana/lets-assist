#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { getLocalSupabaseEnv } from "./dv-local-env.mjs";

const PROFILE_COUNT = 1_000;
const APPLICATION_COUNT = 600;
const INSERT_BATCH_SIZE = 200;
const RELATION_BATCH_SIZE = 200;

const { url, serviceRoleKey } = getLocalSupabaseEnv();
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const plugin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: "plugin_data" },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function batches(rows, size = INSERT_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function insertBatches(table, rows) {
  for (const batch of batches(rows)) {
    const { error } = await plugin.from(table).insert(batch);
    if (error) throw new Error(`Failed to insert ${table} scale fixtures: ${error.message}`);
  }
}

async function timed(label, operation) {
  const startedAt = performance.now();
  const value = await operation();
  return { label, milliseconds: Math.round((performance.now() - startedAt) * 10) / 10, value };
}

const suffix = `${Date.now()}`.slice(-9);
const organizationId = crypto.randomUUID();
const cohortId = crypto.randomUUID();
const termId = crypto.randomUUID();
const username = `csf-scale-${suffix}`;
let runError = null;

try {
  const { error: organizationError } = await admin.from("organizations").insert({
    id: organizationId,
    name: "CSF Scale Verification",
    username,
    type: "school",
    description: "Transient fictional fixture for local CSF acceptance testing.",
    show_members_publicly: false,
    join_code: suffix.slice(-6),
  });
  if (organizationError) throw new Error(`Failed to create scale organization: ${organizationError.message}`);

  const [{ error: cohortError }, { error: termError }] = await Promise.all([
    plugin.from("csf_cohorts").insert({
      id: cohortId,
      organization_id: organizationId,
      graduation_year: 2030,
      label: "Class of 2030",
    }),
    plugin.from("csf_terms").insert({
      id: termId,
      organization_id: organizationId,
      code: "S29",
      label: "Spring 2029",
      school_year: "2028-2029",
      semester: "spring",
      starts_at: "2029-01-01",
      ends_at: "2029-06-30",
      is_current: true,
    }),
  ]);
  if (cohortError) throw new Error(`Failed to create scale cohort: ${cohortError.message}`);
  if (termError) throw new Error(`Failed to create scale term: ${termError.message}`);

  const profiles = Array.from({ length: PROFILE_COUNT }, (_, index) => {
    const number = String(index + 1).padStart(4, "0");
    return {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      first_name: `Student${number}`,
      last_name: `Fixture${String(Math.floor(index / 25) + 1).padStart(3, "0")}`,
      school_email: `csf-scale-${number}@students.local.test`,
      normalized_first_name: `student${number}`,
      normalized_last_name: `fixture${String(Math.floor(index / 25) + 1).padStart(3, "0")}`,
      normalized_school_email: `csf-scale-${number}@students.local.test`,
      source_summary: { fictionalScaleFixture: true, sequence: index + 1 },
    };
  });
  const memberships = profiles.map((profile) => ({
    organization_id: organizationId,
    profile_id: profile.id,
    cohort_id: cohortId,
    status: "active",
  }));
  const applications = profiles.slice(0, APPLICATION_COUNT).map((profile, index) => ({
    organization_id: organizationId,
    profile_id: profile.id,
    cohort_id: cohortId,
    term_id: termId,
    source: "legacy_import",
    status: index % 9 === 0 ? "needs_action" : "needs_review",
    submission_status: index % 9 === 0 ? "missing_information" : "ready",
    eligibility_status: index % 7 === 0 ? "pending" : "eligible",
    decision_status: "pending",
    current_grade_level: 11,
    list_i_points: 4,
    list_i_ii_points: 7,
    grand_total_points: 10,
    submitted_at: new Date(Date.UTC(2029, 0, 2, 8, index % 60)).toISOString(),
    application_data: { fictionalScaleFixture: true, sequence: index + 1 },
  }));

  const load = await timed("fixture load", async () => {
    await insertBatches("csf_profiles", profiles);
    await insertBatches("csf_profile_cohort_memberships", memberships);
    await insertBatches("csf_term_applications", applications);
  });

  const directory = await timed("1,000-member directory", async () => {
    const loaded = [];
    for (let start = 0; start < PROFILE_COUNT; start += 250) {
      const { data, error } = await plugin
        .from("csf_profiles")
        .select("id, first_name, last_name, school_email, record_status, updated_at")
        .eq("organization_id", organizationId)
        .eq("record_status", "active")
        .order("last_name", { ascending: true })
        .order("first_name", { ascending: true })
        .range(start, start + 249);
      if (error) throw error;
      loaded.push(...(data ?? []));
    }
    return loaded;
  });

  const queue = await timed("600-application review queue", async () => {
    const { data, error, count } = await plugin
      .from("csf_term_applications")
      .select("id, profile_id, submission_status, eligibility_status, decision_status, assigned_to, submitted_at", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("term_id", termId)
      .eq("decision_status", "pending")
      .order("submitted_at", { ascending: true })
      .range(0, APPLICATION_COUNT - 1);
    if (error) throw error;
    return { rows: data ?? [], count: count ?? 0 };
  });

  const relations = await timed("directory relation batches", async () => {
    const profileIds = profiles.map((profile) => profile.id);
    const result = await Promise.all(batches(profileIds, RELATION_BATCH_SIZE).map(async (profileIdBatch) => {
      const [{ data: classRows, error: classError }, { data: applicationRows, error: applicationError }] = await Promise.all([
        plugin
          .from("csf_profile_cohort_memberships")
          .select("profile_id, status, cohort:csf_cohorts!csf_profile_cohort_memberships_cohort_id_fkey(label, graduation_year)")
          .eq("organization_id", organizationId)
          .in("profile_id", profileIdBatch),
        plugin
          .from("csf_term_applications")
          .select("profile_id, submission_status, eligibility_status, decision_status, term:csf_terms!csf_term_applications_term_organization_fkey(code, label, is_current)")
          .eq("organization_id", organizationId)
          .in("profile_id", profileIdBatch),
      ]);
      if (classError) throw classError;
      if (applicationError) throw applicationError;
      return { classRows: classRows ?? [], applicationRows: applicationRows ?? [] };
    }));
    return {
      classRows: result.reduce((total, part) => total + part.classRows.length, 0),
      applicationRows: result.reduce((total, part) => total + part.applicationRows.length, 0),
    };
  });

  assert(directory.value.length === PROFILE_COUNT, `Expected ${PROFILE_COUNT} directory rows, received ${directory.value.length}.`);
  assert(queue.value.count === APPLICATION_COUNT, `Expected ${APPLICATION_COUNT} queued applications, received ${queue.value.count}.`);
  assert(queue.value.rows.length === APPLICATION_COUNT, "Application queue pagination dropped rows.");
  assert(relations.value.classRows === PROFILE_COUNT, "Class relation batching dropped member rows.");
  assert(relations.value.applicationRows === APPLICATION_COUNT, "Application relation batching dropped application rows.");

  console.log(JSON.stringify({
    ok: true,
    fictional: true,
    profiles: PROFILE_COUNT,
    applications: APPLICATION_COUNT,
    timings: [load, directory, queue, relations].map(({ label, milliseconds }) => ({ label, milliseconds })),
  }, null, 2));
} catch (error) {
  runError = error;
}

let cleanupFailure = null;
try {
  const { error: cleanupError } = await admin.from("organizations").delete().eq("id", organizationId);
  if (cleanupError) throw new Error(`Scale fixture cleanup failed for ${organizationId}: ${cleanupError.message}`);

  const cleanupChecks = await Promise.all([
    admin.from("organizations").select("id", { count: "exact", head: true }).eq("id", organizationId),
    plugin.from("csf_profiles").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    plugin.from("csf_profile_cohort_memberships").select("profile_id", { count: "exact", head: true }).eq("organization_id", organizationId),
    plugin.from("csf_term_applications").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    plugin.from("csf_cohorts").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    plugin.from("csf_terms").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
  ]);
  const cleanupLabels = ["organization", "profiles", "cohort memberships", "applications", "cohorts", "terms"];
  cleanupChecks.forEach((result, index) => {
    if (result.error) {
      throw new Error(`Failed to verify ${cleanupLabels[index]} cleanup for ${organizationId}: ${result.error.message}`);
    }
    assert(result.count === 0, `Scale fixture cleanup left ${result.count ?? "unknown"} ${cleanupLabels[index]} rows for ${organizationId}.`);
  });
} catch (error) {
  cleanupFailure = error;
}

if (runError && cleanupFailure) {
  throw new AggregateError([runError, cleanupFailure], "CSF scale verification and fixture cleanup both failed.");
}
if (runError) throw runError;
if (cleanupFailure) throw cleanupFailure;
