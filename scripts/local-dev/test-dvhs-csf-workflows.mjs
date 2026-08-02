#!/usr/bin/env bun

import { createClient } from "@supabase/supabase-js";
import { getCsfIsolatedSupabaseEnv } from "./dv-local-env.mjs";

const { url, anonKey, serviceRoleKey } = getCsfIsolatedSupabaseEnv({
  // Bun loads repository .env files automatically. Pass only the explicit
  // generated-stack identity so a partial ambient Supabase bundle cannot
  // override or invalidate the isolated target selected by the operator.
  CSF_ISOLATED_WORK_DIR: process.env.CSF_ISOLATED_WORK_DIR,
});
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const plugin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "plugin_data" } });
const anonPlugin = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "plugin_data" } });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { data: organization, error: orgError } = await admin.from("organizations").select("id, username").eq("username", "dvhs-csf").maybeSingle();
if (orgError || !organization) throw orgError ?? new Error("DVHS CSF organization fixture is missing.");

const [profilesResult, membershipsResult, termsResult, submissionsResult, filesResult, creditsResult, auditResult] = await Promise.all([
  plugin.from("csf_profiles").select("id, first_name, last_name, school_email, personal_email").eq("organization_id", organization.id),
  plugin.from("csf_term_memberships").select("id, profile_id, term_id, status, application_id").eq("organization_id", organization.id),
  plugin.from("csf_terms").select("id, code, is_current, closed_at").eq("organization_id", organization.id),
  plugin.from("csf_point_submissions").select("id, profile_id, term_id, status").eq("organization_id", organization.id),
  plugin.from("csf_submission_files").select("id, submission_id, bucket, object_path").eq("organization_id", organization.id),
  plugin.from("csf_credit_records").select("id, submission_id, profile_id, term_id, points, status").eq("organization_id", organization.id),
  plugin.from("csf_admin_audit_events").select("id, action, target_type").eq("organization_id", organization.id),
]);
for (const result of [profilesResult, membershipsResult, termsResult, submissionsResult, filesResult, creditsResult, auditResult]) {
  if (result.error) throw result.error;
}

assert((profilesResult.data?.length ?? 0) >= 3, "CSF workflow fixture must include multiple profiles.");
assert((membershipsResult.data?.length ?? 0) >= 2, "CSF workflow fixture must include explicit term memberships.");
assert((termsResult.data ?? []).some((term) => term.code === "S26"), "S26 legacy term is missing.");
assert((auditResult.data?.length ?? 0) > 0, "Consequential CSF workflow audit events are missing.");

const fileCounts = new Map();
for (const file of filesResult.data ?? []) fileCounts.set(file.submission_id, (fileCounts.get(file.submission_id) ?? 0) + 1);
assert([...fileCounts.values()].every((count) => count === 1), "A point submission has more than one proof file.");
assert((filesResult.data ?? []).every((file) => file.bucket === "csf-private"), "CSF proof escaped the private storage bucket.");

const proofProbeSubmission = submissionsResult.data?.[0];
assert(Boolean(proofProbeSubmission), "CSF workflow fixture has no submission for the proof uniqueness probe.");
const creditCounts = new Map();
for (const credit of creditsResult.data ?? []) {
  if (!credit.submission_id) continue;
  creditCounts.set(credit.submission_id, (creditCounts.get(credit.submission_id) ?? 0) + 1);
}
assert([...creditCounts.values()].every((count) => count === 1), "A point submission produced more than one credit award.");
const awardedSubmission = (creditsResult.data ?? []).find((credit) => credit.submission_id);
assert(Boolean(awardedSubmission), "CSF workflow fixture has no awarded submission for the credit uniqueness probe.");

const proofProbe = {
  organization_id: organization.id,
  submission_id: proofProbeSubmission.id,
  profile_id: proofProbeSubmission.profile_id,
  term_id: proofProbeSubmission.term_id,
  bucket: "csf-private",
  object_path: `csf/${organization.id}/test-only/proof-uniqueness-probe.pdf`,
  original_filename: "proof-uniqueness-probe.pdf",
  mime_type: "application/pdf",
  size_bytes: 1,
  upload_status: "finalized",
  finalized_at: new Date().toISOString(),
  failed_at: null,
};

// Every probe row is attributable to a real fixture profile, so track each ID the
// database actually returned — including an unexpectedly successful duplicate —
// and delete exactly those IDs even when an insertion, assertion, or the cleanup
// itself fails.
const proofProbeIds = [];
const creditProbeIds = [];
const cleanupFailures = [];
let probeFailure;

// Each cleanup is independently fail-safe: a thrown client call is recorded like
// any returned error so the other table is still cleaned up.
async function deleteProbeRows(table, ids) {
  if (ids.length === 0) return;
  let result;
  try {
    result = await plugin.from(table).delete().in("id", ids).select("id");
  } catch (error) {
    cleanupFailures.push(
      `${table} probe cleanup threw for ${ids.join(", ")}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  if (result?.error) {
    cleanupFailures.push(`${table} probe cleanup failed: ${result.error.message}`);
    return;
  }
  const removed = new Set((result?.data ?? []).map((row) => row.id));
  const stranded = ids.filter((id) => !removed.has(id));
  if (stranded.length > 0) {
    cleanupFailures.push(`${table} probe cleanup left ${stranded.join(", ")} in place.`);
  }
}

try {
  const firstProofInsert = await plugin.from("csf_submission_files").insert(proofProbe).select("id").single();
  if (firstProofInsert.data?.id) proofProbeIds.push(firstProofInsert.data.id);
  if (firstProofInsert.error) throw firstProofInsert.error;
  const duplicateProofInsert = await plugin.from("csf_submission_files").insert({ ...proofProbe, object_path: `${proofProbe.object_path}.duplicate` }).select("id").single();
  if (duplicateProofInsert.data?.id) proofProbeIds.push(duplicateProofInsert.data.id);
  assert(duplicateProofInsert.error?.code === "23505", "Database did not enforce one proof per CSF submission.");

  // The refusal below should create no row at all, but never assume it: capture
  // whatever ID the database returns so a contract change cannot strand one.
  const duplicateCreditInsert = await plugin.from("csf_credit_records").insert({
    organization_id: organization.id,
    submission_id: awardedSubmission.submission_id,
    profile_id: awardedSubmission.profile_id,
    term_id: awardedSubmission.term_id,
    source: "manual",
    points: 0,
    point_type: "non_drive",
    status: "pending",
  }).select("id").single();
  if (duplicateCreditInsert.data?.id) creditProbeIds.push(duplicateCreditInsert.data.id);
  assert(duplicateCreditInsert.error?.code === "23505", "Database did not enforce one awarded credit per CSF submission.");
} catch (error) {
  probeFailure = error;
} finally {
  // Both cleanups always run: neither can be skipped because the other failed.
  await deleteProbeRows("csf_submission_files", proofProbeIds);
  await deleteProbeRows("csf_credit_records", creditProbeIds);
}

if (probeFailure) {
  for (const failure of cleanupFailures) console.error(`CSF probe cleanup failure: ${failure}`);
  throw probeFailure;
}
if (cleanupFailures.length > 0) {
  throw new Error(`CSF uniqueness probes left attributable rows behind: ${cleanupFailures.join(" | ")}`);
}

const { data: anonymousProfiles, error: anonymousProfileError } = await anonPlugin.from("csf_profiles").select("id").limit(1);
assert(Boolean(anonymousProfileError) || (anonymousProfiles?.length ?? 0) === 0, "Anonymous client could read private CSF profiles.");

// Public-route evidence is only ever claimed for an explicitly supplied app URL.
// Without one this run makes no request at all, so a caught privacy assertion can
// never be misreported as "app unavailable".
const appOrigin = process.env.CSF_APP_URL?.trim();
let publicRouteVerified = false;

// Route unavailability and a reachable privacy failure stay distinct: only the
// transport call is wrapped, so an assertion below can never be relabelled as an
// unreachable app. Both still fail the run.
async function requestPublicRoute(path, init) {
  try {
    return await fetch(`${appOrigin}${path}`, init);
  } catch (error) {
    throw new Error(
      `CSF public route ${path} was unreachable at the explicit CSF_APP_URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (appOrigin) {
  const rootResponse = await requestPublicRoute("/organization/dvhs-csf", { redirect: "manual" });
  assert(rootResponse.status === 307, `Organization root returned ${rootResponse.status}, expected 307.`);
  assert(rootResponse.headers.get("location")?.endsWith("/plugins/dvhs-csf/public"), "Organization root did not redirect to the CSF public route.");
  const publicResponse = await requestPublicRoute("/organization/dvhs-csf/plugins/dvhs-csf/public");
  const html = await publicResponse.text();
  assert(publicResponse.ok, `CSF public route returned ${publicResponse.status}.`);
  assert(html.includes("Dougherty Valley High School CSF"), "CSF public route is missing the organization identity.");
  assert(html.includes("Upcoming activities"), "CSF public route is missing the public activity surface.");
  assert(html.includes("https://www.dvhighcsf.org/"), "CSF public route is missing the official website link.");
  assert(!html.includes("Student records stay private"), "CSF public route still renders removed privacy-marketing copy.");
  for (const profile of profilesResult.data ?? []) {
    assert(!html.includes(`${profile.first_name} ${profile.last_name}`), `Public CSF route leaked ${profile.first_name} ${profile.last_name}.`);
    for (const email of [profile.school_email, profile.personal_email]) {
      if (email) assert(!html.includes(email), "Public CSF route leaked a private member email.");
    }
  }
  const privateIdentifiers = [
    ...(membershipsResult.data ?? []).map((row) => row.id),
    ...(submissionsResult.data ?? []).map((row) => row.id),
    ...(auditResult.data ?? []).map((row) => row.id),
    ...(filesResult.data ?? []).flatMap((row) => [row.id, row.object_path]),
  ].filter(Boolean);
  for (const identifier of privateIdentifiers) {
    assert(!html.includes(String(identifier)), "CSF public route serialized a private record identifier.");
  }
  publicRouteVerified = true;
} else {
  console.warn(
    "CSF_APP_URL was not supplied: this run verified database workflows only and requested no public route.",
  );
}

console.log(JSON.stringify({
  ok: true,
  verified: publicRouteVerified ? "database-workflows-and-public-route" : "database-workflows-only",
  organizationId: organization.id,
  profiles: profilesResult.data?.length ?? 0,
  termMemberships: membershipsResult.data?.length ?? 0,
  submissions: submissionsResult.data?.length ?? 0,
  proofFiles: filesResult.data?.length ?? 0,
  singleProofConstraintVerified: true,
  awardedCredits: creditsResult.data?.length ?? 0,
  singleCreditConstraintVerified: true,
  auditEvents: auditResult.data?.length ?? 0,
  anonymousProfileReadBlocked: true,
  publicRouteVerified,
}, null, 2));
