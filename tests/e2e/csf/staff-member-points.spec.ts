import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { loadCsfFeedFixture } from "./feed-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  localTestPassword,
  watchBrowserFailures,
} from "./helpers";

function checked(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

test("organization staff in member view sees only their own point history without point permissions", async ({
  page,
}) => {
  const fixture = await loadCsfFeedFixture();
  const plugin = fixture.admin.schema("plugin_data");
  const suffix = randomUUID();
  const email = `staff.member.${suffix}@local.test`;
  const profileIds = [randomUUID(), randomUUID()];
  const submissionIds = [randomUUID(), randomUUID()];
  const ownDescription = `Owned fictional staff history ${suffix}`;
  const otherDescription = `Other fictional profile history ${suffix}`;
  const { data: created, error: userError } =
    await fixture.admin.auth.admin.createUser({
      email,
      password: localTestPassword(),
      email_confirm: true,
      user_metadata: { full_name: `Casey Staff-${suffix}` },
    });
  checked(userError);
  if (!created.user)
    throw new Error("Could not create the owned staff account.");
  const userId = created.user.id;
  const failures = watchBrowserFailures(page);
  try {
    checked(
      (
        await fixture.admin.from("organization_members").insert({
          organization_id: fixture.organizationId,
          user_id: userId,
          role: "staff",
          status: "active",
        })
      ).error,
    );
    checked(
      (
        await plugin.from("csf_profiles").insert(
          profileIds.map((id, index) => ({
            id,
            organization_id: fixture.organizationId,
            first_name: index === 0 ? "Casey" : "Morgan",
            last_name: `Staff-${suffix}`,
            normalized_first_name: index === 0 ? "casey" : "morgan",
            normalized_last_name: `staff-${suffix}`,
            school_email: index === 0 ? email : `other.${suffix}@local.test`,
            normalized_school_email:
              index === 0 ? email : `other.${suffix}@local.test`,
          })),
        )
      ).error,
    );
    checked(
      (
        await plugin.from("csf_profile_cohort_memberships").insert(
          profileIds.map((id) => ({
            organization_id: fixture.organizationId,
            profile_id: id,
            cohort_id: fixture.cohortIdsByYear[2028],
            status: "active",
          })),
        )
      ).error,
    );
    checked(
      (
        await plugin.from("csf_profile_accounts").insert({
          organization_id: fixture.organizationId,
          profile_id: profileIds[0],
          user_id: userId,
          status: "verified",
          is_primary: true,
          connection_basis: "officer_decision",
          linked_by: fixture.organizationAdminUserId,
        })
      ).error,
    );
    checked(
      (
        await plugin.from("csf_point_submissions").insert(
          profileIds.map((id, index) => ({
            id: submissionIds[index],
            organization_id: fixture.organizationId,
            profile_id: id,
            term_id: fixture.currentTermId,
            source: "staff",
            claimed_points: 1,
            point_type: "non_drive",
            status: "withdrawn",
            description: index === 0 ? ownDescription : otherDescription,
          })),
        )
      ).error,
    );

    const destination = `${CSF_ORGANIZATION_PATH}?tab=csf-home`;
    await page.goto(`/login?redirect=${encodeURIComponent(destination)}`);
    const form = page.getByRole("main").locator('form[data-hydrated="true"]');
    await expect(form).toBeVisible();
    await expect(
      page.getByText("Secure check ready", { exact: true }),
    ).toBeVisible();
    await form.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await form.getByLabel("Password").fill(localTestPassword());
    await form.getByRole("button", { name: "Login", exact: true }).click();
    await page.waitForURL(
      (url) =>
        url.pathname === CSF_ORGANIZATION_PATH &&
        url.searchParams.get("tab") === "csf-home",
    );
    await expect(
      page.getByRole("button", {
        name: "Switch to CSF Officer view",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("tab", { name: "Point submissions", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Point submissions", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(ownDescription, { exact: true })).toBeVisible();
    await expect(page.getByText(otherDescription, { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(ownDescription, { exact: true })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
    const { data: membership, error: membershipError } = await fixture.admin
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", userId)
      .single();
    checked(membershipError);
    expect(membership).toEqual({ role: "staff", status: "active" });
    expectNoBrowserFailures(failures);
  } finally {
    // Retain the fictional point rows and their profile references. Remove only
    // this run's login and host membership, preserving all immutable history.
    checked(
      (
        await fixture.admin
          .from("organization_members")
          .delete()
          .eq("organization_id", fixture.organizationId)
          .eq("user_id", userId)
      ).error,
    );
    checked((await fixture.admin.auth.admin.deleteUser(userId)).error);
  }
});
