import { ReleaseCheckError } from "./app-release-checks.mjs";

/**
 * 20260916040000_csf_officer_identity_authority replaces three reviewed
 * definitions in place: the merge preview now separates attestable findings
 * from blocking ones, the officer connection supersedes competing pending
 * claims, and the connection evidence reports those claims instead of
 * refusing. Only their fingerprints move; every other posture in the accepted
 * catalog is carried through untouched.
 */
export const officerIdentityAuthorityFingerprints = [
  // plugin_data.csf_profile_merge_preview(uuid,uuid,uuid)
  ["abda3e08cd11a412fbb919906c95fe74", "eabcc76e3e61eea9bcd91a6487b10c20"],
  // plugin_data.csf_profile_link_connect_evidence(uuid,uuid,uuid)
  ["524766459ce161c31250d01b691ca7c9", "f0aaa289ceda518c32ef0ea8468493ba"],
  // plugin_data.csf_staff_connect_profile_account(uuid,uuid,uuid,text,text,uuid)
  ["f55544457947c753af0a8f527d7d25d6", "3f0ee9027a1a89b94e395cd320ae2abb"],
];

export function officerIdentityAuthorityCatalog(query) {
  for (const [before, after] of officerIdentityAuthorityFingerprints) {
    if (query.split(before).length !== 2)
      throw new ReleaseCheckError(
        "The reviewed officer identity catalog contract changed.",
      );
    query = query.replace(before, after);
  }
  return query;
}
