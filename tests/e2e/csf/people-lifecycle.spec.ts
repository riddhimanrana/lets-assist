import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  localActors,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const assignmentSchoolYear = "2026-2027";

/**
 * Visible coverage for the people lifecycle. This catches production breaks
 * where the profile form stops persisting cohort state, officer review stops
 * creating the verified account and host membership, or assignment stops
 * propagating to active staff state.
 */
type PeopleLifecycleFixture = {
  admin: SupabaseClient;
  adminUserId: string;
  organizationId: string;
  cohortId: string;
  retirementTargetProfileId: string;
  roleId: string;
  profileEmail: string;
  requestId: string;
  userId?: string;
  profileId?: string;
  staffPositionId?: string;
};

function assertNoSupabaseError(
  operation: string,
  error: { message: string } | null,
) {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

async function loadFixture(): Promise<PeopleLifecycleFixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plugin = admin.schema("plugin_data");
  const suffix = randomUUID().slice(0, 8);
  const profileEmail = `avery.lifecycle.${suffix}@students.local.test`;

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("username", "dvhs-csf")
    .single();
  if (organizationError || !organization) {
    throw new Error(
      `Could not load the local DVHS CSF organization: ${organizationError?.message ?? "missing fixture"}`,
    );
  }

  const [
    { data: cohort, error: cohortError },
    { data: retirementTarget, error: retirementTargetError },
    { data: role, error: roleError },
    usersResult,
  ] = await Promise.all([
    plugin
      .from("csf_cohorts")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("graduation_year", 2028)
      .single(),
    plugin
      .from("csf_profiles")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("normalized_school_email", "nina.kapoor28@students.local.test")
      .single(),
    plugin
      .from("csf_roles")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("public_title", "Activity Coordinator")
      .eq("responsibility_label", "Service activities")
      .single(),
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
  ]);

  assertNoSupabaseError(
    "Could not load the Class of 2028 fixture",
    cohortError,
  );
  if (!cohort) throw new Error("The Class of 2028 fixture is missing.");
  assertNoSupabaseError(
    "Could not load the fixture retirement target",
    retirementTargetError,
  );
  if (!retirementTarget)
    throw new Error("The fixture retirement target is missing.");
  assertNoSupabaseError(
    "Could not load Activity Coordinator — Service activities",
    roleError,
  );
  if (!role)
    throw new Error("The seeded Activity Coordinator role is missing.");
  if (usersResult.error) {
    throw new Error(
      `Could not load local auth fixtures: ${usersResult.error.message}`,
    );
  }
  const adminUser = usersResult.data.users.find(
    (user) => user.email === localActors.admin.email,
  );
  if (!adminUser)
    throw new Error("The local CSF admin auth fixture is missing.");

  return {
    admin,
    adminUserId: adminUser.id,
    organizationId: organization.id,
    cohortId: cohort.id,
    retirementTargetProfileId: retirementTarget.id,
    roleId: role.id,
    profileEmail,
    requestId: randomUUID(),
  };
}

async function cleanFixture(fixture: PeopleLifecycleFixture) {
  const plugin = fixture.admin.schema("plugin_data");
  let profileId = fixture.profileId;
  if (!profileId) {
    const { data: discoveredProfile, error: profileDiscoveryError } =
      await plugin
        .from("csf_profiles")
        .select("id")
        .eq("organization_id", fixture.organizationId)
        .eq("normalized_school_email", fixture.profileEmail)
        .maybeSingle();
    assertNoSupabaseError(
      "Could not discover the fixture profile for cleanup",
      profileDiscoveryError,
    );
    profileId = discoveredProfile?.id;
    fixture.profileId = profileId;
  }

  const { data: discoveredRequest, error: requestDiscoveryError } = await plugin
    .from("csf_profile_link_requests")
    .select("id, user_id")
    .eq("organization_id", fixture.organizationId)
    .eq("signed_in_email", fixture.profileEmail)
    .maybeSingle();
  assertNoSupabaseError(
    "Could not discover the fixture connection request for cleanup",
    requestDiscoveryError,
  );

  let staffPositionId = fixture.staffPositionId;
  if (!staffPositionId && profileId) {
    const { data: discoveredPosition, error: discoveryError } = await plugin
      .from("csf_staff_positions")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("profile_id", profileId)
      .eq("role_id", fixture.roleId)
      .eq("school_year", assignmentSchoolYear)
      .eq("status", "active")
      .maybeSingle();
    assertNoSupabaseError(
      "Could not discover the fixture staff access for cleanup",
      discoveryError,
    );
    staffPositionId = discoveredPosition?.id;
  }

  if (staffPositionId) {
    const { error } = await plugin.rpc("csf_revoke_staff_position", {
      p_organization_id: fixture.organizationId,
      p_staff_position_id: staffPositionId,
      p_effective_end_date: new Date().toISOString().slice(0, 10),
      p_reason: "Retiring synthetic people-lifecycle browser fixture.",
      p_actor_user_id: fixture.adminUserId,
    });
    assertNoSupabaseError("Could not revoke the fixture staff access", error);
  }

  let userId = fixture.userId ?? discoveredRequest?.user_id ?? undefined;
  if (!userId && profileId) {
    const { data: discoveredAccount, error: accountDiscoveryError } =
      await plugin
        .from("csf_profile_accounts")
        .select("user_id")
        .eq("organization_id", fixture.organizationId)
        .eq("profile_id", profileId)
        .maybeSingle();
    assertNoSupabaseError(
      "Could not discover the fixture profile account for cleanup",
      accountDiscoveryError,
    );
    userId = discoveredAccount?.user_id;
  }
  if (!userId) {
    const usersResult = await fixture.admin.auth.admin.listUsers({
      page: 1,
      perPage: 1_000,
    });
    if (usersResult.error) {
      throw new Error(
        `Could not discover the fixture auth user for cleanup: ${usersResult.error.message}`,
      );
    }
    userId = usersResult.data.users.find(
      (user) => user.email === fixture.profileEmail,
    )?.id;
  }
  fixture.userId = userId;

  if (profileId || userId) {
    let accountCleanup = plugin
      .from("csf_profile_accounts")
      .update({
        status: "revoked",
        is_primary: false,
        revoked_at: new Date().toISOString(),
        notes: "Retired synthetic people-lifecycle browser fixture.",
      })
      .eq("organization_id", fixture.organizationId);
    if (profileId) accountCleanup = accountCleanup.eq("profile_id", profileId);
    else if (userId) accountCleanup = accountCleanup.eq("user_id", userId);
    const { error } = await accountCleanup;
    assertNoSupabaseError(
      "Could not revoke the fixture profile account",
      error,
    );
  }

  if (userId) {
    const { error: membershipError } = await fixture.admin
      .from("organization_members")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", userId);
    assertNoSupabaseError(
      "Could not remove the fixture host membership",
      membershipError,
    );
  }

  if (discoveredRequest) {
    const { error: requestError } = await plugin
      .from("csf_profile_link_requests")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("id", discoveredRequest.id);
    assertNoSupabaseError(
      "Could not clean the fixture connection request",
      requestError,
    );
  }

  if (profileId) {
    // The visible lifecycle writes immutable audit history. Retire and
    // de-identify the test-owned record instead of trying to delete that audit.
    const { error } = await plugin
      .from("csf_profiles")
      .update({
        record_status: "merged",
        merged_into_profile_id: fixture.retirementTargetProfileId,
        merged_at: new Date().toISOString(),
        merged_by: fixture.adminUserId,
        merge_reason: "Retired synthetic people-lifecycle browser fixture.",
        school_email: null,
        normalized_school_email: null,
        personal_email: null,
        normalized_personal_email: null,
      })
      .eq("organization_id", fixture.organizationId)
      .eq("id", profileId);
    assertNoSupabaseError("Could not retire the fixture profile", error);
  }

  if (userId) {
    const { error } = await fixture.admin.auth.admin.deleteUser(userId);
    assertNoSupabaseError("Could not delete the fixture auth user", error);
  }
}

async function openMembers(page: Page) {
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await expect(page).toHaveURL(/[?&]tab=csf-members(?:&|$)/);
}

test.describe("CSF visible people lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: PeopleLifecycleFixture;

  test.beforeAll(async () => {
    fixture = await loadFixture();
  });

  test.afterAll(async () => {
    if (fixture) await cleanFixture(fixture);
  });

  test("creates, verifies, and assigns a student through the officer workflow", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin", CSF_ORGANIZATION_PATH);
    await openMembers(page);

    await page.getByRole("button", { name: "Add member", exact: true }).click();
    const createDialog = page.getByRole("dialog", {
      name: "Add a student record",
    });
    await createDialog.getByLabel("First name").fill("Avery");
    await createDialog
      .getByLabel("Last name")
      .fill(`Lifecycle-${fixture.profileEmail.slice(16, 24)}`);
    await createDialog.getByLabel("Preferred name").fill("Avery");
    await createDialog.getByLabel("School email").fill(fixture.profileEmail);
    await createDialog.getByRole("combobox", { name: "Class" }).click();
    await page
      .getByRole("option", { name: "Class of 2028", exact: true })
      .click();
    await createDialog
      .getByRole("button", { name: "Add student record", exact: true })
      .click();
    await expect(createDialog).toBeHidden();

    const plugin = fixture.admin.schema("plugin_data");
    await expect
      .poll(async () => {
        const { data, error } = await plugin
          .from("csf_profiles")
          .select("id, first_name, normalized_school_email")
          .eq("organization_id", fixture.organizationId)
          .eq("normalized_school_email", fixture.profileEmail)
          .single();
        assertNoSupabaseError("Could not load the created profile", error);
        return data;
      })
      .toMatchObject({
        first_name: "Avery",
        normalized_school_email: fixture.profileEmail,
      });
    const { data: profile, error: profileError } = await plugin
      .from("csf_profiles")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("normalized_school_email", fixture.profileEmail)
      .single();
    assertNoSupabaseError("Could not select the created profile", profileError);
    if (!profile) throw new Error("The created CSF profile is missing.");
    fixture.profileId = profile.id;

    const { data: cohortMembership, error: cohortMembershipError } =
      await plugin
        .from("csf_profile_cohort_memberships")
        .select("profile_id, cohort_id, status")
        .eq("organization_id", fixture.organizationId)
        .eq("profile_id", fixture.profileId)
        .single();
    assertNoSupabaseError(
      "Could not load the created cohort membership",
      cohortMembershipError,
    );
    expect(cohortMembership).toEqual({
      profile_id: fixture.profileId,
      cohort_id: fixture.cohortId,
      status: "active",
    });
    await expect(
      page.getByRole("row").filter({ hasText: fixture.profileEmail }),
    ).toBeVisible();

    const { data: createdUser, error: userError } =
      await fixture.admin.auth.admin.createUser({
        email: fixture.profileEmail,
        password: randomUUID(),
        email_confirm: true,
      });
    if (userError || !createdUser.user) {
      throw new Error(
        `Could not create the confirmed fixture account: ${userError?.message ?? "missing user"}`,
      );
    }
    fixture.userId = createdUser.user.id;

    const { error: requestError } = await plugin
      .from("csf_profile_link_requests")
      .insert({
        id: fixture.requestId,
        organization_id: fixture.organizationId,
        cohort_id: fixture.cohortId,
        user_id: fixture.userId,
        signed_in_email: fixture.profileEmail,
        school_email: fixture.profileEmail,
        first_name: "Avery",
        last_name: `Lifecycle-${fixture.profileEmail.slice(16, 24)}`,
        normalized_first_name: "avery",
        normalized_last_name: `lifecycle-${fixture.profileEmail.slice(16, 24)}`,
        candidate_profile_ids: [fixture.profileId],
        match_status: "needs_review",
      });
    assertNoSupabaseError(
      "Could not create the corroborated review request",
      requestError,
    );

    await page.getByRole("button", { name: "Account connections" }).click();
    const connections = page.getByRole("region", {
      name: "Account connections",
    });
    await expect(connections).toBeVisible();
    const fixtureRequestCard = connections
      .getByText(
        `Submitted school address ${fixture.profileEmail} · Account confirmation is checked in Resolve`,
        { exact: true },
      )
      .locator("..")
      .locator("..");
    await expect(fixtureRequestCard).toHaveCount(1);
    await fixtureRequestCard
      .getByRole("button", { name: "Resolve", exact: true })
      .click();
    const resolveDialog = page.getByRole("dialog", {
      name: "Review account connection",
    });
    await resolveDialog
      .getByRole("combobox", { name: "Student record" })
      .click();
    await page
      .getByRole("option", { name: new RegExp(fixture.profileEmail) })
      .click();
    await expect(
      resolveDialog.getByText("Canonical identity evidence"),
    ).toBeVisible();
    const emailSeparator = fixture.profileEmail.indexOf("@");
    const emailLocalPart = fixture.profileEmail.slice(0, emailSeparator);
    const maskedFixtureEmail = `${emailLocalPart.slice(0, 2)}${"•".repeat(Math.max(emailLocalPart.length - 2, 1))}${fixture.profileEmail.slice(emailSeparator)}`;
    // The review dialog intentionally masks addresses, but must still prove the
    // current confirmed account and roster addresses are this fixture's match.
    await expect(
      resolveDialog.getByText(
        `Current confirmed account address ${maskedFixtureEmail} matches roster address ${maskedFixtureEmail}.`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      resolveDialog.getByText("Exact first and last name match."),
    ).toBeVisible();
    await expect(
      resolveDialog.getByText(
        "Exactly one active membership matches the requested class.",
      ),
    ).toBeVisible();
    await resolveDialog
      .getByLabel("Decision reason")
      .fill("Confirmed email, exact name, and Class of 2028 match.");
    await resolveDialog
      .getByRole("button", { name: "Connect account" })
      .click();
    await expect(resolveDialog).toBeHidden();

    await expect
      .poll(async () => {
        const [{ data: account }, { data: member }, { data: request }] =
          await Promise.all([
            plugin
              .from("csf_profile_accounts")
              .select("status, is_primary")
              .eq("organization_id", fixture.organizationId)
              .eq("profile_id", fixture.profileId!)
              .eq("user_id", fixture.userId!)
              .single(),
            fixture.admin
              .from("organization_members")
              .select("role, status")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId!)
              .single(),
            plugin
              .from("csf_profile_link_requests")
              .select("match_status")
              .eq("organization_id", fixture.organizationId)
              .eq("id", fixture.requestId)
              .single(),
          ]);
        return { account, member, request };
      })
      .toEqual({
        account: { status: "verified", is_primary: true },
        member: { role: "member", status: "active" },
        request: { match_status: "resolved" },
      });
    await expect(
      connections.getByText("No account matches need a decision."),
    ).toBeVisible();
    await connections
      .getByRole("button", { name: "Member directory", exact: true })
      .click();
    const directorySearch = page.getByLabel("Search members");
    await directorySearch.fill(fixture.profileEmail);
    // The simplified filter bar has no Apply button; Enter submits the GET
    // form the same way the removed button did.
    await directorySearch.press("Enter");
    if (!fixture.profileId) {
      throw new Error("The connected CSF profile id is missing.");
    }
    const profileName = `Avery Lifecycle-${fixture.profileEmail.slice(16, 24)}`;
    const connectedProfileLink = page.getByRole("link", {
      name: new RegExp(profileName),
    });
    const connectedRow = page.getByRole("row").filter({
      has: connectedProfileLink,
    });
    await expect(connectedProfileLink).toBeVisible();
    await expect(connectedProfileLink).toHaveAttribute(
      "href",
      new RegExp(
        `^${CSF_ORGANIZATION_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?(?=[^#]*\\btab=csf-members(?:&|$))(?=[^#]*\\bcsf_profile=${fixture.profileId}(?:&|$))`,
      ),
    );
    await expect(connectedRow).toContainText(profileName);
    await expect(
      connectedRow.getByText("Connected", { exact: true }),
    ).toBeVisible();

    const moreButton = page.getByRole("button", {
      name: "More",
      exact: true,
    });
    await expect(moreButton).toHaveAttribute("aria-expanded", "false");
    await moreButton.click();
    const staffAccessItem = page.getByRole("menuitem", {
      name: "Staff access",
      exact: true,
    });
    await expect(staffAccessItem).toBeVisible();
    await staffAccessItem.click();
    await expect(
      page.getByRole("heading", { name: "Officer roster", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Assign position", exact: true })
      .click();
    const assignmentDialog = page.getByRole("dialog", {
      name: "Assign staff access",
    });
    const profileField = assignmentDialog
      .getByText("CSF member profile", { exact: true })
      .locator("..");
    await profileField.getByRole("combobox").click();
    await page
      .getByRole("option", { name: new RegExp(fixture.profileEmail) })
      .click();
    await assignmentDialog.getByRole("combobox", { name: "Position" }).click();
    await page
      .getByRole("option", {
        name: "Activity Coordinator — Service activities",
        exact: true,
      })
      .click();
    // The school year is never typed: the dialog assigns for the roster's
    // selected year and states it in its description.
    await expect(
      assignmentDialog.getByText(
        `Assigning for the ${assignmentSchoolYear} school year.`,
      ),
    ).toBeVisible();
    await assignmentDialog
      .getByRole("button", { name: "Assign access" })
      .click();
    await expect(assignmentDialog).toBeHidden();
    await expect(
      page.getByText("Staff access assigned.", { exact: true }),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const { data, error } = await plugin
          .from("csf_staff_positions")
          .select("id, status, school_year, role_id, user_id")
          .eq("organization_id", fixture.organizationId)
          .eq("profile_id", fixture.profileId!)
          .eq("role_id", fixture.roleId)
          .eq("school_year", assignmentSchoolYear)
          .single();
        assertNoSupabaseError(
          "Could not load the active staff position",
          error,
        );
        return data;
      })
      .toMatchObject({
        status: "active",
        school_year: assignmentSchoolYear,
        role_id: fixture.roleId,
        user_id: fixture.userId,
      });
    const { data: staffPosition, error: staffPositionError } = await plugin
      .from("csf_staff_positions")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("profile_id", fixture.profileId)
      .eq("role_id", fixture.roleId)
      .eq("school_year", assignmentSchoolYear)
      .single();
    assertNoSupabaseError(
      "Could not select the active staff position",
      staffPositionError,
    );
    if (!staffPosition)
      throw new Error("The active staff position is missing.");
    fixture.staffPositionId = staffPosition.id;

    const rosterRow = page
      .getByRole("region", { name: "Officer roster" })
      .getByRole("row")
      .filter({ hasText: fixture.profileEmail });
    await expect(rosterRow).toBeVisible();
    await expect(rosterRow).toContainText("Activity Coordinator");
    await expect(rosterRow).toContainText("Service activities");
    // The roster shows one school year at a time; the header picker names it
    // instead of a per-row column.
    await expect(
      page
        .getByRole("region", { name: "Officer roster" })
        .getByText(assignmentSchoolYear)
        .first(),
    ).toBeVisible();

    const { data: staffMembership, error: staffMembershipError } =
      await fixture.admin
        .from("organization_members")
        .select("role, status")
        .eq("organization_id", fixture.organizationId)
        .eq("user_id", fixture.userId)
        .single();
    assertNoSupabaseError(
      "Could not verify the preserved host membership",
      staffMembershipError,
    );
    expect(staffMembership).toEqual({ role: "staff", status: "active" });

    expectNoBrowserFailures(failures);
  });
});
