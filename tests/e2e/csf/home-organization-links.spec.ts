import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { fixtureJoinCode } from "../../../scripts/local-dev/seed-platform-fixtures.mjs";
import { loadCsfFeedFixture } from "./feed-fixtures";
import { CSF_ORGANIZATION_PATH, localActors, loginAs } from "./helpers";

test("Home opens the CSF chapter and excludes ordinary organizations even with active membership", async ({
  page,
}) => {
  const { admin, organizationAdminUserId } = await loadCsfFeedFixture();
  const organizations = ["Active", "Inactive", "Unrelated"].map((label) => {
    const id = randomUUID();
    return {
      id,
      name: `Fictional ${label} ${id.slice(0, 8)}`,
      username: `home-${id.slice(0, 8)}`,
      type: "school",
      join_code: fixtureJoinCode(id),
      created_by: organizationAdminUserId,
    };
  });
  const [active, inactive, unrelated] = organizations;
  const ids = organizations.map(({ id }) => id);
  const member = await admin
    .from("profiles")
    .select("id")
    .eq("email", localActors.member.email)
    .single();
  expect(member.error).toBeNull();
  if (!member.data) throw new Error("Fictional member is missing");
  const priorPreferences = await admin
    .from("user_plugin_display_preferences")
    .select("show_plugin_content, hidden_plugin_keys")
    .eq("user_id", member.data.id)
    .maybeSingle();
  expect(priorPreferences.error).toBeNull();

  try {
    const inserted = await admin.from("organizations").insert(organizations);
    expect(inserted.error).toBeNull();
    const memberships = await admin.from("organization_members").insert([
      ...ids.map((organizationId) => ({
        organization_id: organizationId,
        user_id: organizationAdminUserId,
        role: "admin",
        status: "active",
      })),
      {
        organization_id: active.id,
        user_id: member.data.id,
        role: "member",
        status: "active",
      },
      {
        organization_id: inactive.id,
        user_id: member.data.id,
        role: "member",
        status: "inactive",
      },
    ]);
    expect(memberships.error).toBeNull();

    await loginAs(page, "member", "/home");
    const navigation = page.getByRole("navigation", {
      name: "Your organizations",
      exact: true,
    });
    const link = navigation.getByRole("link", {
      name: "Open DVHS CSF",
      exact: true,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", CSF_ORGANIZATION_PATH);
    for (const organization of organizations) {
      await expect(
        navigation.getByRole("link", {
          name: `Open ${organization.name}`,
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await link.click();
    await page.waitForURL(`**${CSF_ORGANIZATION_PATH}`);
    await expect(
      page.getByRole("heading", { name: "DVHS CSF", exact: true }),
    ).toBeVisible();

    await page.goto("/account/plugins");
    const csfSetting = page.getByRole("switch", {
      name: "DVHS CSF",
      exact: true,
    });
    await expect(csfSetting).toBeEnabled();
    await csfSetting.click();
    await expect(csfSetting).toHaveAttribute("aria-checked", "false");
    await expect(csfSetting).toBeEnabled();
    await page.goto("/home");
    await expect(
      page.getByRole("navigation", { name: "Your organizations", exact: true }),
    ).toHaveCount(0);
    await page.goto(CSF_ORGANIZATION_PATH);
    await expect(
      page.getByRole("heading", { name: "DVHS CSF", exact: true }),
    ).toBeVisible();

    await page.goto("/account/plugins");
    await page.getByRole("switch", { name: "DVHS CSF", exact: true }).click();
    await expect(
      page.getByRole("switch", { name: "DVHS CSF", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    const globalSetting = page.getByRole("switch", {
      name: "Show organization content on your home and dashboard",
      exact: true,
    });
    await expect(globalSetting).toBeEnabled();
    await globalSetting.click();
    await expect(globalSetting).toHaveAttribute("aria-checked", "false");
    await expect(globalSetting).toBeEnabled();
    await page.goto("/home");
    await expect(
      page.getByRole("navigation", { name: "Your organizations", exact: true }),
    ).toHaveCount(0);

    await page.context().clearCookies();
    await loginAs(page, "outsider", "/home");
    for (const organization of organizations) {
      await expect(
        page.getByRole("link", {
          name: `Open ${organization.name}`,
          exact: true,
        }),
      ).toHaveCount(0);
    }
  } finally {
    const restoredPreferences = priorPreferences.data
      ? await admin
          .from("user_plugin_display_preferences")
          .upsert(
            { user_id: member.data.id, ...priorPreferences.data },
            { onConflict: "user_id" },
          )
      : await admin
          .from("user_plugin_display_preferences")
          .delete()
          .eq("user_id", member.data.id);
    expect(restoredPreferences.error).toBeNull();
    const memberships = await admin
      .from("organization_members")
      .delete()
      .in("organization_id", ids);
    expect(memberships.error).toBeNull();
    const removed = await admin.from("organizations").delete().in("id", ids);
    expect(removed.error).toBeNull();
  }
});
