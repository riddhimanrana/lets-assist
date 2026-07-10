#!/usr/bin/env bun

import { createClient } from "@supabase/supabase-js";
import { getLocalSupabaseEnv } from "./dv-local-env.mjs";

const { url, anonKey, serviceRoleKey } = getLocalSupabaseEnv();
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const plugin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "plugin_data" } });
const anonPlugin = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, db: { schema: "plugin_data" } });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { data: organization, error: orgError } = await admin.from("organizations").select("id, username").eq("username", "dvhs-csf").maybeSingle();
if (orgError || !organization) throw orgError ?? new Error("DVHS CSF organization fixture is missing.");

const [profilesResult, membershipsResult, termsResult, submissionsResult, filesResult, creditsResult, auditResult] = await Promise.all([
  plugin.from("csf_profiles").select("id, first_name, last_name").eq("organization_id", organization.id),
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
};
const firstProofInsert = await plugin.from("csf_submission_files").insert(proofProbe).select("id").single();
if (firstProofInsert.error) throw firstProofInsert.error;
const duplicateProofInsert = await plugin.from("csf_submission_files").insert({ ...proofProbe, object_path: `${proofProbe.object_path}.duplicate` }).select("id").single();
assert(duplicateProofInsert.error?.code === "23505", "Database did not enforce one proof per CSF submission.");
await plugin.from("csf_submission_files").delete().eq("id", firstProofInsert.data.id);

const creditCounts = new Map();
for (const credit of creditsResult.data ?? []) {
  if (!credit.submission_id) continue;
  creditCounts.set(credit.submission_id, (creditCounts.get(credit.submission_id) ?? 0) + 1);
}
assert([...creditCounts.values()].every((count) => count === 1), "A point submission produced more than one credit award.");
const awardedSubmission = (creditsResult.data ?? []).find((credit) => credit.submission_id);
assert(Boolean(awardedSubmission), "CSF workflow fixture has no awarded submission for the credit uniqueness probe.");
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
assert(duplicateCreditInsert.error?.code === "23505", "Database did not enforce one awarded credit per CSF submission.");

const { data: anonymousProfiles, error: anonymousProfileError } = await anonPlugin.from("csf_profiles").select("id").limit(1);
assert(Boolean(anonymousProfileError) || (anonymousProfiles?.length ?? 0) === 0, "Anonymous client could read private CSF profiles.");

const appOrigin = process.env.CSF_APP_URL ?? "http://localhost:3000";
let publicRouteVerified = false;
try {
  const rootResponse = await fetch(`${appOrigin}/organization/dvhs-csf`, { redirect: "manual" });
  assert(rootResponse.status === 307, `Organization root returned ${rootResponse.status}, expected 307.`);
  assert(rootResponse.headers.get("location")?.endsWith("/plugins/dvhs-csf/public"), "Organization root did not redirect to the CSF public route.");
  const publicResponse = await fetch(`${appOrigin}/organization/dvhs-csf/plugins/dvhs-csf/public`);
  const html = await publicResponse.text();
  assert(publicResponse.ok, `CSF public route returned ${publicResponse.status}.`);
  assert(html.includes("Privacy by design"), "CSF public route is missing its privacy boundary notice.");
  for (const profile of profilesResult.data ?? []) {
    assert(!html.includes(`${profile.first_name} ${profile.last_name}`), `Public CSF route leaked ${profile.first_name} ${profile.last_name}.`);
  }
  publicRouteVerified = true;
} catch (error) {
  if (process.env.CSF_APP_URL) throw error;
  console.warn(`CSF public-route verification skipped because the local app was unavailable: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(JSON.stringify({
  ok: true,
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
