import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  buildSyntheticAccounts,
  buildSyntheticMemberProfiles,
  deterministicFixtureUuid,
  FIXTURE_MARKER,
  FIXTURE_ORGANIZATION_HANDLE,
  FIXTURE_ORGANIZATION_ID,
  FIXTURE_ORGANIZATION_JOIN_CODE,
  fixtureOrganizationPath,
  MEMBER_PROFILE_COUNT,
  MEMBER_SESSION_COUNT,
  OFFICER_SESSION_COUNT,
  PRODUCTION_PROJECT_REF,
} from "./csf-load-fixture.mjs";
import {
  assertSyntheticOrganizationBoundary,
  buildFixtureRows,
  provisionDatabase,
  validateIsolatedProvisionTarget,
  validateProvisionTarget,
} from "./provision-csf-load-fixtures.mjs";

const provisionerSource = readFileSync(
  new URL("./provision-csf-load-fixtures.mjs", import.meta.url),
  "utf8",
);
const runnerSource = readFileSync(
  new URL("./test-csf-load.mjs", import.meta.url),
  "utf8",
);

const developmentProjectRef = "abcdefghijklmnopqrst";

function validEnvironment() {
  return {
    CSF_HOSTED_LOAD_ORGANIZATION_HANDLE: FIXTURE_ORGANIZATION_HANDLE,
    CSF_HOSTED_LOAD_PASSWORD: "synthetic-password-for-tests-only",
    CSF_HOSTED_LOAD_PROVISION_CONFIRMATION: `provision-hosted-development:${developmentProjectRef}:${FIXTURE_ORGANIZATION_HANDLE}`,
    EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: developmentProjectRef,
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
    SUPABASE_URL: `https://${developmentProjectRef}.supabase.co`,
  };
}

describe("hosted CSF load fixture contract", () => {
  test("derives one fixed pool with deterministic synthetic identities", () => {
    const first = buildSyntheticAccounts();
    const second = buildSyntheticAccounts();
    const accounts = [...first.members, ...first.officers];

    expect(first).toEqual(second);
    expect(first.members).toHaveLength(MEMBER_SESSION_COUNT);
    expect(first.officers).toHaveLength(OFFICER_SESSION_COUNT);
    expect(new Set(accounts.map(({ email }) => email)).size).toBe(100);
    expect(new Set(accounts.map(({ authUserId }) => authUserId)).size).toBe(
      100,
    );
    expect(new Set(accounts.map(({ profileId }) => profileId)).size).toBe(100);
    expect(new Set(accounts.map(({ username }) => username)).size).toBe(100);
    expect(
      accounts.every(({ email }) =>
        /^[^\s@]+@csf-load\.local\.test$/u.test(email),
      ),
    ).toBe(true);
    expect(
      accounts.every(({ authUserId }) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          authUserId,
        ),
      ),
    ).toBe(true);
    expect(
      accounts.every(({ username }) =>
        /^(?:member|officer)-[0-9]{3}-fixture$/u.test(username),
      ),
    ).toBe(true);
    expect(deterministicFixtureUuid("sample", 1)).toBe(
      deterministicFixtureUuid("sample", 1),
    );
    expect(FIXTURE_ORGANIZATION_HANDLE).toBe("csf-load-fixture");
    expect(fixtureOrganizationPath("?tab=csf-profile")).toBe(
      "/organization/csf-load-fixture?tab=csf-profile",
    );
    expect(() => fixtureOrganizationPath("tab=csf-profile")).toThrow();

    const roster = buildSyntheticMemberProfiles(first.members);
    expect(roster).toHaveLength(MEMBER_PROFILE_COUNT);
    expect(
      roster.filter(({ linkedAccountKey }) => linkedAccountKey !== null),
    ).toHaveLength(MEMBER_SESSION_COUNT);
    expect(
      roster.filter(({ linkedAccountKey }) => linkedAccountKey === null),
    ).toHaveLength(MEMBER_PROFILE_COUNT - MEMBER_SESSION_COUNT);
    expect(new Set(roster.map(({ profileId }) => profileId)).size).toBe(
      MEMBER_PROFILE_COUNT,
    );
  });

  test("refuses Production and any organization-handle override", () => {
    expect(validateProvisionTarget(validEnvironment())).toMatchObject({
      organizationHandle: FIXTURE_ORGANIZATION_HANDLE,
      projectRef: developmentProjectRef,
      supabaseUrl: `https://${developmentProjectRef}.supabase.co`,
    });

    expect(() =>
      validateProvisionTarget({
        ...validEnvironment(),
        EXPECTED_NON_PRODUCTION_SUPABASE_PROJECT_REF: PRODUCTION_PROJECT_REF,
        SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      }),
    ).toThrow("non-Production");
    expect(() =>
      validateProvisionTarget({
        ...validEnvironment(),
        CSF_HOSTED_LOAD_ORGANIZATION_HANDLE: "dvhs-csf",
      }),
    ).toThrow("refuses the real DVHS organization");
    expect(() =>
      validateProvisionTarget({
        ...validEnvironment(),
        CSF_HOSTED_LOAD_ORGANIZATION_HANDLE: "another-fixture",
      }),
    ).toThrow("pinned to its synthetic organization");
  });

  test("permits database execution only through a validated hosted or loopback target", async () => {
    expect(
      validateIsolatedProvisionTarget({
        CSF_HOSTED_LOAD_PASSWORD: "synthetic-password-for-tests-only",
        CSF_LOCAL_LOAD_PROVISION_CONFIRMATION:
          "provision-isolated-local:csf-load-fixture",
        SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
        SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toMatchObject({
      environmentKind: "isolated-local",
      organizationHandle: FIXTURE_ORGANIZATION_HANDLE,
      supabaseUrl: "http://127.0.0.1:54321",
    });
    expect(() =>
      validateIsolatedProvisionTarget({
        CSF_HOSTED_LOAD_PASSWORD: "synthetic-password-for-tests-only",
        CSF_LOCAL_LOAD_PROVISION_CONFIRMATION:
          "provision-isolated-local:csf-load-fixture",
        SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
        SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      }),
    ).toThrow("requires a loopback Supabase URL");
    expect(
      provisionDatabase({
        environmentKind: "isolated-local",
        organizationHandle: FIXTURE_ORGANIZATION_HANDLE,
      }),
    ).rejects.toThrow("requires a validated target");
  });

  test("fails closed when a fixed organization identity is already owned", () => {
    expect(() => assertSyntheticOrganizationBoundary([])).not.toThrow();
    expect(() =>
      assertSyntheticOrganizationBoundary([
        {
          description: FIXTURE_MARKER,
          id: FIXTURE_ORGANIZATION_ID,
          join_code: FIXTURE_ORGANIZATION_JOIN_CODE,
          username: FIXTURE_ORGANIZATION_HANDLE,
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertSyntheticOrganizationBoundary([
        {
          description: "not the fixture marker",
          id: FIXTURE_ORGANIZATION_ID,
          join_code: FIXTURE_ORGANIZATION_JOIN_CODE,
          username: FIXTURE_ORGANIZATION_HANDLE,
        },
      ]),
    ).toThrow("already owned by another row");
    expect(() =>
      assertSyntheticOrganizationBoundary([
        {
          description: null,
          id: "11111111-1111-4111-8111-111111111111",
          join_code: FIXTURE_ORGANIZATION_JOIN_CODE,
          username: "unrelated-fixture",
        },
      ]),
    ).toThrow("join code is already in use");
  });

  test("builds repeatable member, officer, term, and application rows", () => {
    const accounts = buildSyntheticAccounts();
    const usersByKey = new Map(
      [...accounts.members, ...accounts.officers].map((account) => [
        account.key,
        { id: account.authUserId },
      ]),
    );
    const first = buildFixtureRows(usersByKey);
    const second = buildFixtureRows(usersByKey);

    expect(first).toEqual(second);
    expect(first.profiles).toHaveLength(
      MEMBER_PROFILE_COUNT + OFFICER_SESSION_COUNT,
    );
    expect(first.profileAccounts).toHaveLength(100);
    expect(first.profileCohorts).toHaveLength(MEMBER_PROFILE_COUNT);
    expect(first.termMemberships).toHaveLength(MEMBER_PROFILE_COUNT);
    expect(first.applications).toHaveLength(MEMBER_PROFILE_COUNT);
    expect(first.staffPositions).toHaveLength(OFFICER_SESSION_COUNT);
    expect(first.staffViewPreferences).toHaveLength(OFFICER_SESSION_COUNT);
    expect(
      new Set(first.applications.map(({ profile_id }) => profile_id)).size,
    ).toBeGreaterThanOrEqual(2);
    expect(
      [
        ...first.profiles,
        ...first.profileAccounts,
        ...first.profileCohorts,
        ...first.termMemberships,
        ...first.applications,
        ...first.staffPositions,
      ].every(
        ({ organization_id }) => organization_id === FIXTURE_ORGANIZATION_ID,
      ),
    ).toBe(true);
  });

  test("uses scoped upserts and never lists users or resets data", () => {
    expect(provisionerSource).toContain("getUserById(account.authUserId)");
    expect(provisionerSource).toContain("id: account.authUserId");
    expect(provisionerSource).toContain("username: account.username");
    expect(provisionerSource).toContain("updateUserById(existing.id, payload)");
    expect(provisionerSource).not.toContain("listUsers");
    expect(provisionerSource).not.toContain(".delete(");
    expect(provisionerSource).not.toContain("account-pool");
    expect(provisionerSource).not.toContain("GITHUB_OUTPUT");
    expect(provisionerSource).toContain(
      "validatedProvisionTargets.has(target)",
    );
    expect(provisionerSource).toContain(
      "await assertRemoteFixtureIdentityBoundary(pluginDb)",
    );
    expect(provisionerSource).toContain(
      "organizationId !== FIXTURE_ORGANIZATION_ID",
    );
    expect(provisionerSource).toContain(
      'error instanceof FixtureProvisionError ? error.message : "Fixture provisioning failed."',
    );
    expect(runnerSource).toContain("buildSyntheticAccounts()");
    expect(runnerSource).toContain("fixtureOrganizationPath(");
    expect(runnerSource).toContain("expectedAccount.authUserId.toLowerCase()");
    expect(runnerSource).toContain(
      "payload.app_metadata?.fixture_role !== role",
    );
    expect(runnerSource).not.toContain("/organization/dvhs-csf");
    expect(runnerSource).not.toContain("_ACCOUNTS_JSON");
  });
});
