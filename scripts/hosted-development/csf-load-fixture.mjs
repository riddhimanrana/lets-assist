import { createHash } from "node:crypto";

export const PRODUCTION_PROJECT_REF = "fotdmeakexgrkronxlof";
export const FIXTURE_ORGANIZATION_HANDLE = "csf-load-fixture";
export const FORBIDDEN_ORGANIZATION_HANDLE = "dvhs-csf";
export const FIXTURE_MARKER = "csf-hosted-load-fixture/v1";
export const FIXTURE_ORGANIZATION_ID = "c5f10000-0000-4000-8000-000000000001";
export const FIXTURE_ORGANIZATION_JOIN_CODE = "976401";
export const FIXTURE_TERM_ID = "c5f16000-0000-4000-8000-000000000001";
export const FIXTURE_COHORT_ID = "c5f15000-0000-4000-8000-000000000001";
export const FIXTURE_ROLE_ID = "c5f17000-0000-4000-8000-000000000001";
export const FIXTURE_REVIEW_PERIOD_ID = "c5f18000-0000-4000-8000-000000000001";
export const MEMBER_PROFILE_COUNT = 1_000;
export const MEMBER_SESSION_COUNT = 90;
export const OFFICER_SESSION_COUNT = 10;

export function deterministicFixtureUuid(namespace, index) {
  const digest = createHash("sha256")
    .update(`${FIXTURE_MARKER}:${namespace}:${index}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function buildAccount(role, index) {
  const ordinal = String(index + 1).padStart(3, "0");
  const key = `${role}-${ordinal}`;
  const namespaceIndex =
    role === "member" ? index + 1 : MEMBER_SESSION_COUNT + index + 1;
  return {
    authUserId: deterministicFixtureUuid("auth-user", namespaceIndex),
    email: `${key}@csf-load.local.test`,
    fullName: `Load ${role === "member" ? "Member" : "Officer"} ${ordinal}`,
    key,
    profileId:
      role === "member"
        ? deterministicFixtureUuid("profile", namespaceIndex)
        : deterministicFixtureUuid("officer-profile", index + 1),
    role,
    username: `${key}-fixture`,
    ...(role === "member"
      ? { applicationId: deterministicFixtureUuid("application", index + 1) }
      : {
          staffPositionId: deterministicFixtureUuid(
            "staff-position",
            index + 1,
          ),
        }),
  };
}

export function buildSyntheticAccounts() {
  return {
    members: Array.from({ length: MEMBER_SESSION_COUNT }, (_, index) =>
      buildAccount("member", index),
    ),
    officers: Array.from({ length: OFFICER_SESSION_COUNT }, (_, index) =>
      buildAccount("officer", index),
    ),
  };
}

export function buildSyntheticMemberProfiles(memberAccounts) {
  const accountByIndex = memberAccounts ?? buildSyntheticAccounts().members;
  if (accountByIndex.length !== MEMBER_SESSION_COUNT) {
    throw new Error("The synthetic member account pool has the wrong size.");
  }
  return Array.from({ length: MEMBER_PROFILE_COUNT }, (_, index) => {
    const ordinal = String(index + 1).padStart(4, "0");
    const account = accountByIndex[index] ?? null;
    return {
      applicationId:
        account?.applicationId ??
        deterministicFixtureUuid("application", index + 1),
      email: account?.email ?? `profile-${ordinal}@csf-load.local.test`,
      key: account?.key ?? `profile-${ordinal}`,
      linkedAccountKey: account?.key ?? null,
      ordinal,
      profileId:
        account?.profileId ?? deterministicFixtureUuid("profile", index + 1),
    };
  });
}

export function fixtureOrganizationPath(search = "") {
  if (search && !search.startsWith("?")) {
    throw new Error(
      "The synthetic organization route search must start with ?.",
    );
  }
  return `/organization/${FIXTURE_ORGANIZATION_HANDLE}${search}`;
}
