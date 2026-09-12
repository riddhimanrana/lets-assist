import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  cleanFeedPosts,
  loadCsfFeedFixture,
  seedFeedPosts,
} from "./feed-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  localTestPassword,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const staffPath = `${CSF_ORGANIZATION_PATH}?tab=csf-staff`;
const homePath = `${CSF_ORGANIZATION_PATH}?tab=csf-home`;

function checked(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function loginOwnedMember(page: Page, email: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(homePath)}`);
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
}

test("assigning and revoking a staff position changes post access while officer posts stay out of member feeds", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const fixture = await loadCsfFeedFixture();
  const plugin = fixture.admin.schema("plugin_data");
  const suffix = randomUUID();
  const prefix = `Synthetic staff audience ${suffix}`;
  const staffTitle = `${prefix} private officer note`;
  const classTitle = `${prefix} class notice`;
  const otherClassTitle = `${prefix} other class notice`;
  const memberTitle = `${prefix} member notice`;
  const roleId = randomUUID();
  const profileId = randomUUID();
  const roleTitle = `Fictional editor ${suffix}`;
  const email = `staff.lifecycle.${suffix}@local.test`;
  const name = `Casey Editor-${suffix}`;
  const { data: created, error: userError } =
    await fixture.admin.auth.admin.createUser({
      email,
      password: localTestPassword(),
      email_confirm: true,
      user_metadata: { full_name: name, has_completed_intro_tour: true },
    });
  checked(userError);
  if (!created.user)
    throw new Error("The owned fictional account was not created.");
  const userId = created.user.id;
  const actorContext = await browser.newContext();
  const actor = await actorContext.newPage();
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  const errors = [page, actor, viewer].map(watchBrowserFailures);
  let testFailure: unknown;
  try {
    checked(
      (
        await fixture.admin
          .from("organization_members")
          .insert({
            organization_id: fixture.organizationId,
            user_id: userId,
            role: "member",
            status: "active",
          })
      ).error,
    );
    checked(
      (
        await plugin
          .from("csf_profiles")
          .insert({
            id: profileId,
            organization_id: fixture.organizationId,
            first_name: "Casey",
            last_name: `Editor-${suffix}`,
            normalized_first_name: "casey",
            normalized_last_name: `editor-${suffix}`,
            school_email: email,
            normalized_school_email: email,
          })
      ).error,
    );
    checked(
      (
        await plugin
          .from("csf_profile_accounts")
          .insert({
            organization_id: fixture.organizationId,
            profile_id: profileId,
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
        await plugin
          .from("csf_profile_cohort_memberships")
          .insert({
            organization_id: fixture.organizationId,
            profile_id: profileId,
            cohort_id: fixture.cohortIdsByYear[2028],
            status: "active",
          })
      ).error,
    );
    // A separate fixture position leaves every established position and seat
    // limit unchanged. Only this run's account can occupy its single seat.
    checked(
      (
        await plugin
          .from("csf_roles")
          .insert({
            id: roleId,
            organization_id: fixture.organizationId,
            key: `fixture_editor_${suffix}`,
            display_name: roleTitle,
            public_title: roleTitle,
            role_type: "custom",
            max_active_seats: 1,
          })
      ).error,
    );
    checked(
      (
        await plugin
          .from("csf_role_permissions")
          .insert({
            organization_id: fixture.organizationId,
            role_id: roleId,
            permission_key: "manage_posts",
            enabled: true,
          })
      ).error,
    );
    await seedFeedPosts(fixture, [
      {
        title: classTitle,
        body: "Fictional notice for the viewer's class.",
        audience: "class",
        audienceCohortId: fixture.cohortIdsByYear[2028],
        pinned: true,
      },
      {
        title: otherClassTitle,
        body: "Fictional notice for another class.",
        audience: "class",
        audienceCohortId: fixture.cohortIdsByYear[2029],
        pinned: true,
      },
      {
        title: memberTitle,
        body: "Fictional notice for linked members.",
        audience: "members",
        pinned: true,
      },
    ]);
    await loginOwnedMember(actor, email);
    await expect(actor.getByText(classTitle, { exact: true })).toBeVisible();
    await expect(
      actor.getByRole("button", {
        name: "Switch to CSF Officer view",
        exact: true,
      }),
    ).toHaveCount(0);

    await loginAs(page, "admin", staffPath);
    await page
      .getByRole("button", { name: "Assign position", exact: true })
      .click();
    const assignment = page.getByRole("dialog", {
      name: "Assign staff access",
      exact: true,
    });
    await assignment.getByRole("combobox", { name: /^Person/ }).click();
    await page
      .getByRole("option", { name: new RegExp(email.replaceAll(".", "\\.")) })
      .click();
    await assignment.getByRole("combobox", { name: /^Position/ }).click();
    await page.getByRole("option", { name: roleTitle, exact: true }).click();
    await assignment
      .getByRole("button", { name: "Assign access", exact: true })
      .click();
    await expect(assignment).toBeHidden();
    const { data: position, error: positionError } = await plugin
      .from("csf_staff_positions")
      .select(
        "id, status, host_membership_managed, host_membership_previous_role",
      )
      .eq("organization_id", fixture.organizationId)
      .eq("role_id", roleId)
      .eq("profile_id", profileId)
      .single();
    checked(positionError);
    expect(position).toMatchObject({
      status: "active",
      host_membership_managed: true,
      host_membership_previous_role: "member",
    });
    if (!position)
      throw new Error("The assigned fictional position is missing.");
    const readHostRole = async () => {
      const result = await fixture.admin
        .from("organization_members")
        .select("role, status")
        .eq("organization_id", fixture.organizationId)
        .eq("user_id", userId)
        .single();
      checked(result.error);
      return result.data;
    };
    expect(await readHostRole()).toEqual({ role: "staff", status: "active" });
    await actor.reload({ waitUntil: "domcontentloaded" });
    await actor
      .getByRole("button", { name: "Switch to CSF Officer view", exact: true })
      .click();
    await actor.getByRole("button", { name: "New post", exact: true }).click();
    const compose = actor.getByRole("dialog", {
      name: "Write a post",
      exact: true,
    });
    await compose.getByLabel("Title", { exact: true }).fill(staffTitle);
    await compose
      .getByLabel("Message", { exact: true })
      .fill(
        "Fictional staff discussion. This text must never reach a member feed.",
      );
    await compose.getByRole("combobox", { name: /^Audience/ }).click();
    await actor.getByRole("option", { name: "Officers", exact: true }).click();
    await compose
      .getByRole("checkbox", {
        name: "Also send this as an email",
        exact: true,
      })
      .uncheck();
    await compose
      .getByRole("button", { name: "Publish post", exact: true })
      .click();
    await compose.getByRole("button", { name: "Close", exact: true }).click();
    await expect(compose).toBeHidden();
    const { data: published, error: publicationError } = await plugin
      .from("csf_announcements")
      .select(
        "id, audience, audience_cohort_id, status, email_requested, email_campaign_id, created_by",
      )
      .eq("organization_id", fixture.organizationId)
      .eq("title", staffTitle)
      .single();
    checked(publicationError);
    expect(published).toMatchObject({
      audience: "officers",
      audience_cohort_id: null,
      status: "published",
      email_requested: false,
      email_campaign_id: null,
      created_by: userId,
    });

    await actor
      .getByRole("button", { name: "View as member", exact: true })
      .click();
    await expect(actor.getByText(classTitle, { exact: true })).toBeVisible();
    await expect(actor.getByText(memberTitle, { exact: true })).toBeVisible();
    expect(await actor.content()).not.toContain(staffTitle);
    expect(await actor.content()).not.toContain(otherClassTitle);
    for (const memberActor of ["member", "applicant"] as const) {
      await viewerContext.clearCookies();
      await loginAs(viewer, memberActor, homePath);
      await expect(
        viewer.getByText(memberTitle, { exact: true }),
      ).toBeVisible();
      expect(await viewer.content()).not.toContain(staffTitle);
    }

    await page.goto(staffPath, { waitUntil: "domcontentloaded" });
    const assignmentRow = page
      .getByRole("row")
      .filter({ hasText: roleTitle })
      .filter({ hasText: name });
    await assignmentRow.getByRole("button", { name: /^Revoke/ }).click();
    const revoke = page.getByRole("dialog", {
      name: "Revoke staff access",
      exact: true,
    });
    const reason = "Finished the fictional staff access browser journey.";
    await revoke.getByLabel("Reason", { exact: true }).fill(reason);
    await revoke
      .getByRole("button", { name: "Revoke access", exact: true })
      .click();
    await expect(revoke).toBeHidden();
    expect(await readHostRole()).toEqual({ role: "member", status: "active" });
    const { data: ended, error: endedError } = await plugin
      .from("csf_staff_positions")
      .select("status, revocation_reason")
      .eq("organization_id", fixture.organizationId)
      .eq("id", position.id)
      .single();
    checked(endedError);
    expect(ended).toEqual({ status: "ended", revocation_reason: reason });
    const { data: history, error: historyError } = await plugin
      .from("csf_staff_position_history")
      .select("action, correlation_id")
      .eq("organization_id", fixture.organizationId)
      .eq("staff_position_id", position.id)
      .order("created_at");
    checked(historyError);
    expect(history?.map((row) => row.action)).toEqual(["assign", "revoke"]);
    for (const row of history ?? [])
      expect(row.correlation_id).toEqual(expect.any(String));
    await actor.reload({ waitUntil: "domcontentloaded" });
    await expect(actor.getByText(classTitle, { exact: true })).toBeVisible();
    await expect(
      actor.getByRole("button", {
        name: "Switch to CSF Officer view",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      actor.getByRole("button", { name: "New post", exact: true }),
    ).toHaveCount(0);
    expect(await actor.content()).not.toContain(staffTitle);
    for (const failureList of errors) expectNoBrowserFailures(failureList);
  } catch (error) {
    testFailure = error;
  }

  const cleanupErrors: unknown[] = [];
  for (const cleanup of [
    async () => {
      const { data, error } = await plugin
        .from("csf_staff_positions")
        .select("id")
        .eq("organization_id", fixture.organizationId)
        .eq("role_id", roleId)
        .eq("profile_id", profileId)
        .eq("status", "active");
      checked(error);
      for (const position of data ?? [])
        checked(
          (
            await plugin.rpc("csf_revoke_staff_position", {
              p_organization_id: fixture.organizationId,
              p_staff_position_id: position.id,
              p_effective_end_date: new Date().toISOString().slice(0, 10),
              p_reason: "Retiring the owned fictional staff fixture.",
              p_actor_user_id: fixture.organizationAdminUserId,
            })
          ).error,
        );
    },
    async () => cleanFeedPosts(fixture, prefix),
    async () =>
      checked(
        (
          await plugin.rpc("csf_set_role_archived", {
            p_organization_id: fixture.organizationId,
            p_role_id: roleId,
            p_archived: true,
            p_reason: "Retiring the owned fictional position.",
            p_actor_user_id: fixture.organizationAdminUserId,
          })
        ).error,
      ),
    async () =>
      checked(
        (
          await fixture.admin
            .from("organization_members")
            .delete()
            .eq("organization_id", fixture.organizationId)
            .eq("user_id", userId)
        ).error,
      ),
    async () =>
      checked((await fixture.admin.auth.admin.deleteUser(userId)).error),
    async () => actorContext.close(),
    async () => viewerContext.close(),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  const failures = [testFailure, ...cleanupErrors].filter(
    (error) => error !== undefined,
  );
  if (failures.length)
    throw new AggregateError(
      failures,
      "The fictional staff and post lifecycle did not complete cleanly.",
    );
});
