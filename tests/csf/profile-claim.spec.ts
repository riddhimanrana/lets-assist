import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../scripts/local-dev/dv-local-env.mjs";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  localActors,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const onboardingCode = "S26-2028";
const connectPath = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/connect/${onboardingCode}`;

type ClaimFixture = {
  admin: SupabaseClient;
  organizationId: string;
  cohortId: string;
  retirementTargetProfileId: string;
  userId: string;
};

async function loadClaimFixture(): Promise<ClaimFixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [{ data: organization, error: organizationError }, usersResult] =
    await Promise.all([
      admin
        .from("organizations")
        .select("id")
        .eq("username", "dvhs-csf")
        .single(),
      admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
    ]);
  if (organizationError || !organization) {
    throw new Error(
      `Could not load the local DVHS CSF organization: ${organizationError?.message ?? "missing fixture"}`,
    );
  }
  if (usersResult.error) {
    throw new Error(`Could not load local auth fixtures: ${usersResult.error.message}`);
  }

  const user = usersResult.data.users.find(
    (candidate) => candidate.email === localActors.outsider.email,
  );
  if (!user) throw new Error("The local outsider auth fixture is missing.");

  const { data: cohort, error: cohortError } = await admin
    .schema("plugin_data")
    .from("csf_cohorts")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("graduation_year", 2028)
    .single();
  if (cohortError || !cohort) {
    throw new Error(
      `Could not load the Class of 2028 fixture: ${cohortError?.message ?? "missing fixture"}`,
    );
  }

  const { data: retirementTarget, error: retirementTargetError } = await admin
    .schema("plugin_data")
    .from("csf_profiles")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("normalized_school_email", "nina.kapoor28@students.local.test")
    .single();
  if (retirementTargetError || !retirementTarget) {
    throw new Error(
      `Could not load the fixture retirement target: ${retirementTargetError?.message ?? "missing fixture"}`,
    );
  }

  return {
    admin,
    organizationId: organization.id,
    cohortId: cohort.id,
    retirementTargetProfileId: retirementTarget.id,
    userId: user.id,
  };
}

async function cleanClaimFixture(fixture: ClaimFixture) {
  const plugin = fixture.admin.schema("plugin_data");

  const { error: requestsError } = await plugin
    .from("csf_profile_link_requests")
    .delete()
    .eq("organization_id", fixture.organizationId)
    .eq("user_id", fixture.userId);
  if (requestsError) throw new Error(`Could not clean claim requests: ${requestsError.message}`);

  const { error: membershipError } = await fixture.admin
    .from("organization_members")
    .delete()
    .eq("organization_id", fixture.organizationId)
    .eq("user_id", fixture.userId);
  if (membershipError) {
    throw new Error(`Could not clean the organization membership: ${membershipError.message}`);
  }

  const { error: accountError } = await plugin
    .from("csf_profile_accounts")
    .update({
      status: "revoked",
      is_primary: false,
      revoked_at: new Date().toISOString(),
      notes: "Retired synthetic browser claim fixture.",
    })
    .eq("organization_id", fixture.organizationId)
    .eq("user_id", fixture.userId);
  if (accountError) throw new Error(`Could not retire claim accounts: ${accountError.message}`);

  // Confirmed claims are referenced by immutable audit rows, so browser
  // fixtures are de-identified rather than deleted. This preserves the
  // production audit contract while keeping the verified email unique for the
  // next run.
  const { error: profileError } = await plugin
    .from("csf_profiles")
    .update({
      record_status: "merged",
      merged_into_profile_id: fixture.retirementTargetProfileId,
      merged_at: new Date().toISOString(),
      merged_by: fixture.userId,
      merge_reason: "Retired synthetic browser claim fixture after verification.",
      personal_email: null,
      normalized_personal_email: null,
    })
    .eq("organization_id", fixture.organizationId)
    .eq("record_status", "active")
    .contains("source_summary", { e2eFixture: true });
  if (profileError) throw new Error(`Could not retire the claim profile: ${profileError.message}`);
}

async function seedClaimCandidate(fixture: ClaimFixture) {
  await cleanClaimFixture(fixture);
  const plugin = fixture.admin.schema("plugin_data");
  const profileId = randomUUID();

  const { error: profileError } = await plugin.from("csf_profiles").insert({
    id: profileId,
    organization_id: fixture.organizationId,
    first_name: "Taylor",
    last_name: "Fixture",
    preferred_name: "Taylor",
    personal_email: localActors.outsider.email,
    normalized_first_name: "taylor",
    normalized_last_name: "fixture",
    normalized_personal_email: localActors.outsider.email,
    source_summary: { e2eFixture: true },
  });
  if (profileError) throw new Error(`Could not seed the claim profile: ${profileError.message}`);

  const { error: cohortMembershipError } = await plugin
    .from("csf_profile_cohort_memberships")
    .insert({
      organization_id: fixture.organizationId,
      profile_id: profileId,
      cohort_id: fixture.cohortId,
      status: "active",
    });
  if (cohortMembershipError) {
    throw new Error(`Could not seed the cohort membership: ${cohortMembershipError.message}`);
  }

  return profileId;
}

test.describe("reusable class-link profile claiming", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: ClaimFixture;
  let profileId: string;

  test.beforeAll(async () => {
    fixture = await loadClaimFixture();
  });

  test.beforeEach(async () => {
    profileId = await seedClaimCandidate(fixture);
  });

  test.afterEach(async () => {
    await cleanClaimFixture(fixture);
  });

  test("an exact verified-email candidate can confirm the pre-generated record", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "outsider", connectPath);

    await expect(
      page.getByRole("heading", { name: "We found your CSF record — is this you?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("Taylor Fixture", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="badge"]').filter({ hasText: /^Class of 2028$/ }),
    ).toBeVisible();
    await expect(page.getByText(localActors.outsider.email, { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Yes, connect this record" }).click();
    await expect
      .poll(async () => {
        const [{ data: member }, { data: account }, { data: request }] = await Promise.all([
          fixture.admin
            .from("organization_members")
            .select("role,status")
            .eq("organization_id", fixture.organizationId)
            .eq("user_id", fixture.userId)
            .maybeSingle(),
          fixture.admin
            .schema("plugin_data")
            .from("csf_profile_accounts")
            .select("status,is_primary")
            .eq("organization_id", fixture.organizationId)
            .eq("profile_id", profileId)
            .eq("user_id", fixture.userId)
            .maybeSingle(),
          fixture.admin
            .schema("plugin_data")
            .from("csf_profile_link_requests")
            .select("match_status")
            .eq("organization_id", fixture.organizationId)
            .eq("user_id", fixture.userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        return { member, account, request };
      })
      .toEqual({
        member: { role: "member", status: "active" },
        account: { status: "verified", is_primary: true },
        request: { match_status: "auto_linked" },
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("main").getByText("Taylor Fixture", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "We found your CSF record — is this you?" }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("Not me creates officer review without linking the account", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "outsider", connectPath);
    await expect(
      page.getByRole("heading", { name: "We found your CSF record — is this you?" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Not me", exact: true }).click();

    await expect
      .poll(async () => {
        const [{ data: member }, { data: account }, { data: request }] = await Promise.all([
          fixture.admin
            .from("organization_members")
            .select("id")
            .eq("organization_id", fixture.organizationId)
            .eq("user_id", fixture.userId)
            .maybeSingle(),
          fixture.admin
            .schema("plugin_data")
            .from("csf_profile_accounts")
            .select("id")
            .eq("organization_id", fixture.organizationId)
            .eq("profile_id", profileId)
            .eq("user_id", fixture.userId)
            .maybeSingle(),
          fixture.admin
            .schema("plugin_data")
            .from("csf_profile_link_requests")
            .select("match_status,matched_profile_id,candidate_profile_ids")
            .eq("organization_id", fixture.organizationId)
            .eq("user_id", fixture.userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        return { member, account, request };
      })
      .toEqual({
        member: null,
        account: null,
        request: {
          match_status: "needs_review",
          matched_profile_id: null,
          candidate_profile_ids: [profileId],
        },
      });

    expectNoBrowserFailures(failures);
  });
});
