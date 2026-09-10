import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { fixtureJoinCode } from "../../../scripts/local-dev/seed-platform-fixtures.mjs";
import { loadCsfFeedFixture } from "./feed-fixtures";
import { localActors, loginAs } from "./helpers";

test("Home opens an active organization without posts and excludes other memberships", async ({
  page,
}) => {
  const { admin, organizationAdminUserId } = await loadCsfFeedFixture();
  const organizations = ["Active", "Inactive", "Unrelated"].map((label) => {
    const id = randomUUID();
    return {
      id,
      name: `Fictional ${label} ${id.slice(0, 8)}`,
      username: `home-${id}`,
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
      name: `Open ${active.name}`,
      exact: true,
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      `/organization/${active.username}`,
    );
    for (const organization of [inactive, unrelated]) {
      await expect(
        navigation.getByRole("link", {
          name: `Open ${organization.name}`,
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await link.click();
    await page.waitForURL(`**/organization/${active.username}`);
    await expect(
      page.getByRole("heading", { name: active.name, exact: true }),
    ).toBeVisible();

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
    const memberships = await admin
      .from("organization_members")
      .delete()
      .in("organization_id", ids);
    expect(memberships.error).toBeNull();
    const removed = await admin.from("organizations").delete().in("id", ids);
    expect(removed.error).toBeNull();
  }
});
