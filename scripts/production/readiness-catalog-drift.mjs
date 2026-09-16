import { ReleaseCheckError } from "./app-release-checks.mjs";

/**
 * Fingerprints the CSF readiness release moves, measured on a replayed
 * isolated database.
 *
 * The accepted catalog fingerprints relations as well as functions, and pins a
 * function by both its full definition and its body, so a release can move any
 * of the three independently. Every value below is read from the replay.
 *
 * Each entry is applied at the first migration in this release that changes
 * the object, so the delegation chain never claims a fingerprint before the
 * migration that produces it. The value is the measured end state: where an
 * object is touched more than once, intermediate ledger lengths are not
 * separately measured and are not claimed to be.
 */

/** Replace one digest literal, refusing when it is not uniquely present. */
function replaceMeasured(query, label, before, after) {
  const parts = query.split(before);
  if (parts.length !== 2) {
    throw new ReleaseCheckError(
      `The accepted catalog no longer carries exactly one ${label} fingerprint.`,
    );
  }
  return parts.join(after);
}

function apply(query, label, swaps) {
  for (const [before, after] of swaps) {
    query = replaceMeasured(query, label, before, after);
  }
  return query;
}

/**
 * 20260916060000 adds csf_admin_audit_events_profile_activity_request_idx, so
 * the relation digest moves. Check 14.
 */
export const OFFICER_ACTIVITY_RELATION_FINGERPRINTS = [
  // plugin_data.csf_admin_audit_events
  ["d1dc57a4ba8b99f76f7f004ce6ba5bbf", "f4cccde4b50d4e96dac5937200b95ea1"],
];

export function officerActivityRelationCatalog(query) {
  return apply(
    query,
    "csf_admin_audit_events relation",
    OFFICER_ACTIVITY_RELATION_FINGERPRINTS,
  );
}

/**
 * 20260916070000 reduces a recognisable class block to its fixed ends inside
 * the acceptance writer and the enable check, so both definitions and both
 * bodies move. Check 38.
 */
export const CLASS_BLOCK_ACCEPTANCE_FINGERPRINTS = [
  // plugin_data.csf_record_sheet_sync_acceptance(uuid,uuid,uuid,uuid[],jsonb,text)
  ["55c423adec03f617d38e2f6ad2d6b243", "97d5d255ac21dafa1e5856005a3e52e6"],
  ["4c8c8dd465f70c036e79e68ff506a738", "068d23af9577932b35421cab0218bcf8"],
  // plugin_data.csf_set_sheet_sync_destination_state(uuid,uuid,uuid,boolean,boolean,text)
  ["6f3a4de65784cd0aee352da1dc47fd5e", "abcd599c61c6ffe7b7ef6aa97520f869"],
  ["f6d62983671d65cb184738ae5837782c", "20a36622839502449852fa30b41ab8b9"],
];

export function classBlockAcceptanceCatalog(query) {
  return apply(query, "sheet acceptance", CLASS_BLOCK_ACCEPTANCE_FINGERPRINTS);
}

/**
 * 20260916090000 rewires csf_staff_connect_profile_account onto the shared
 * supersede helper. Check 35 pins that function twice, by full definition and
 * by md5(p.prosrc), and both move together. Its ACL and guard predicates are
 * unchanged and are left alone.
 */
export const DECISION_SUPERSEDE_FINGERPRINTS = [
  // plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)
  // Full definition.
  ["3f0ee9027a1a89b94e395cd320ae2abb", "56dcc95953b9fae01a5aa41c29383750"],
  // Body, md5(p.prosrc).
  ["5f47bdc9f3dd79de9262c81e6714d42c", "11e91c2070c51ea3bdc029c1c17d7246"],
];

export function decisionSupersedeCatalog(query) {
  return apply(query, "staff connection", DECISION_SUPERSEDE_FINGERPRINTS);
}

/**
 * 20260917010000 adds the decision staging columns and the review-mode guard,
 * moving both relation digests. Checks 14 and 39.
 */
export const DECISION_STAGING_RELATION_FINGERPRINTS = [
  // plugin_data.csf_terms
  ["7d5a926c181e90f73751bbc49ace1109", "e7258ed743fa52f1470ca1b7c5e71d55"],
  // plugin_data.csf_sheet_writeback_ledger
  ["071bf14bd83e3a8fc8c9fa467bce2035", "49593d70560fb48930e243133820990b"],
];

export function decisionStagingRelationCatalog(query) {
  return apply(
    query,
    "decision staging relation",
    DECISION_STAGING_RELATION_FINGERPRINTS,
  );
}

/**
 * 20260917020000 renames the five-argument merge and layers a new wrapper over
 * it, and moves the reference plan with it. Check 34.
 */
export const DECISION_MERGE_OWNERSHIP_FINGERPRINTS = [
  // plugin_data.csf_profile_merge_reference_plan(uuid,uuid)
  ["2f521e9b85f90793c1c0c7197ce3f241", "48a500ad4960c56dffca1cf1a823d3ad"],
  // plugin_data.csf_merge_profiles(uuid,uuid,uuid,text,uuid)
  ["0124ee53995263c7a2e839d20d5e8efe", "fedd02270e8f15a687659a01742a860d"],
];

export function decisionMergeOwnershipCatalog(query) {
  return apply(query, "merge ownership", DECISION_MERGE_OWNERSHIP_FINGERPRINTS);
}
