import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { CSF_ORGANIZATION_PATH, localActors, loginAs } from "./helpers";

type Fixture = {
  admin: SupabaseClient;
  organizationId: string;
  actorId: string;
  retirementTargetId: string;
  userId: string;
  loginEmail: string;
  contactEmail: string;
  profileIds: string[];
  names: string[];
};

function checked(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function createFixture(): Promise<Fixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plugin = admin.schema("plugin_data");
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("username", "dvhs-csf")
    .single();
  checked(organizationError);
  if (!organization) throw new Error("Missing isolated CSF organization.");
  const [
    { data: cohort, error: cohortError },
    { data: target, error: targetError },
    users,
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
    admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
  ]);
  checked(cohortError);
  checked(targetError);
  checked(users.error);
  const actor = users.data.users.find(
    (user) => user.email === localActors.admin.email,
  );
  if (!cohort || !target || !actor)
    throw new Error("Missing isolated CSF fixtures.");
  const suffix = randomUUID().slice(0, 8);
  const loginEmail = `manual.login.${suffix}@local.test`;
  const contactEmail = `manual.roster.${suffix}@students.local.test`;
  const profileIds = [randomUUID(), randomUUID()];
  const names = [`Avery Manual-${suffix}`, `Blair Manual-${suffix}`];
  const { data: account, error: accountError } =
    await admin.auth.admin.createUser({
      email: loginEmail,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: { full_name: names[0] },
    });
  checked(accountError);
  if (!account.user) throw new Error("Missing new fictional account.");
  const fixture = {
    admin,
    organizationId: organization.id,
    actorId: actor.id,
    retirementTargetId: target.id,
    userId: account.user.id,
    loginEmail,
    contactEmail,
    profileIds,
    names,
  };
  try {
    checked(
      (
        await admin
          .from("organization_members")
          .insert({
            organization_id: organization.id,
            user_id: account.user.id,
            role: "member",
            status: "active",
          })
      ).error,
    );
    checked(
      (
        await plugin.from("csf_profiles").insert(
          profileIds.map((id, index) => ({
            id,
            organization_id: organization.id,
            first_name: index === 0 ? "Avery" : "Blair",
            last_name: `Manual-${suffix}`,
            normalized_first_name: index === 0 ? "avery" : "blair",
            normalized_last_name: `manual-${suffix}`,
            school_email:
              index === 0
                ? contactEmail
                : `conflict.${suffix}@students.local.test`,
            normalized_school_email:
              index === 0
                ? contactEmail
                : `conflict.${suffix}@students.local.test`,
          })),
        )
      ).error,
    );
    checked(
      (
        await plugin
          .from("csf_profile_cohort_memberships")
          .insert(
            profileIds.map((id) => ({
              organization_id: organization.id,
              profile_id: id,
              cohort_id: cohort.id,
              status: "active",
            })),
          )
      ).error,
    );
    return fixture;
  } catch (error) {
    await retireFixture(fixture);
    throw error;
  }
}

async function retireFixture(fixture: Fixture) {
  const plugin = fixture.admin.schema("plugin_data");
  checked(
    (
      await plugin
        .from("csf_profile_accounts")
        .update({
          status: "revoked",
          is_primary: false,
          revoked_at: new Date().toISOString(),
          notes: "Retired fictional browser account.",
        })
        .eq("organization_id", fixture.organizationId)
        .in("profile_id", fixture.profileIds)
    ).error,
  );
  checked(
    (
      await fixture.admin
        .from("organization_members")
        .delete()
        .eq("organization_id", fixture.organizationId)
        .eq("user_id", fixture.userId)
    ).error,
  );
  checked(
    (
      await plugin
        .from("csf_profiles")
        .update({
          record_status: "merged",
          merged_into_profile_id: fixture.retirementTargetId,
          merged_at: new Date().toISOString(),
          merged_by: fixture.actorId,
          merge_reason: "Retired fictional manual connection browser fixture.",
          school_email: null,
          normalized_school_email: null,
        })
        .eq("organization_id", fixture.organizationId)
        .in("id", fixture.profileIds)
    ).error,
  );
  checked((await fixture.admin.auth.admin.deleteUser(fixture.userId)).error);
}

async function openProfile(page: Page, profileId: string) {
  await page.goto(
    `${CSF_ORGANIZATION_PATH}?tab=csf-members&csf_profile=${profileId}`,
  );
  await expect(
    page.locator('[data-organization-tabs-hydrated="true"]'),
  ).toBeVisible();
  const tour = page.getByRole("dialog", { name: "Officer workspace tour" });
  if (await tour.isVisible()) {
    await tour.getByRole("button", { name: "Skip tour", exact: true }).click();
    await expect(tour).toBeHidden();
  }
  await expect(
    page.getByRole("region", { name: "Member identity" }),
  ).toBeVisible();
}

async function submitConnection(page: Page, fixture: Fixture, index: number) {
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Connect account to ${fixture.names[index]}`,
  });
  await dialog.getByLabel("Let's Assist login email").fill(fixture.loginEmail);
  await dialog
    .getByLabel("How did you verify this student?")
    .fill("Confirmed the fictional student identity in person.");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  return dialog;
}

test.describe("Staff manual account connection", () => {
  let fixture: Fixture;
  test.beforeAll(async () => {
    fixture = await createFixture();
  });
  test.afterAll(async () => {
    if (fixture) await retireFixture(fixture);
  });

  test("links a different login email, refreshes identity, and refuses an existing connection", async ({
    page,
  }) => {
    await loginAs(page, "admin", CSF_ORGANIZATION_PATH);
    await openProfile(page, fixture.profileIds[0]!);
    const identity = page.getByRole("region", { name: "Member identity" });
    await expect(identity.getByText("CSF-only", { exact: true })).toBeVisible();
    const dialog = await submitConnection(page, fixture, 0);
    await expect(dialog).toBeHidden();
    // No reload: the Server Action must refresh the profile after commit.
    await expect(identity.getByText("Linked", { exact: true })).toBeVisible();
    await expect(
      identity.getByRole("button", { name: "Connect account", exact: true }),
    ).toHaveCount(0);
    await expect(identity).toContainText(fixture.contactEmail);
    const plugin = fixture.admin.schema("plugin_data");
    const { data: linked, error: linkedError } = await plugin
      .from("csf_profile_accounts")
      .select("profile_id,user_id,status,connection_basis")
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", fixture.userId)
      .eq("status", "verified")
      .single();
    checked(linkedError);
    expect(linked).toEqual({
      profile_id: fixture.profileIds[0],
      user_id: fixture.userId,
      status: "verified",
      connection_basis: "officer_decision",
    });
    const { data: member, error: memberError } = await fixture.admin
      .from("organization_members")
      .select("role,status")
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", fixture.userId)
      .single();
    checked(memberError);
    expect(member).toEqual({ role: "member", status: "active" });

    await openProfile(page, fixture.profileIds[1]!);
    const conflict = await submitConnection(page, fixture, 1);
    await expect(
      conflict.getByText(
        "This account is already connected. Unlink the incorrect connection before moving it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(conflict).toBeVisible();
    const { data: connections, error: connectionError } = await plugin
      .from("csf_profile_accounts")
      .select("profile_id")
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", fixture.userId)
      .eq("status", "verified");
    checked(connectionError);
    expect(connections).toEqual([{ profile_id: fixture.profileIds[0] }]);
    const { count, error: auditError } = await plugin
      .from("csf_admin_audit_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", fixture.organizationId)
      .eq("action", "profile.account_connected_by_staff")
      .eq("after_data->>userId", fixture.userId);
    checked(auditError);
    expect(count).toBe(1);
  });
});
