import { expect, test } from "@playwright/test";

import {
  cleanFeedPosts,
  loadCsfFeedFixture,
  seedFeedPosts,
  type CsfFeedFixture,
} from "./feed-fixtures";
import { loginAs } from "./helpers";

const TITLE_PREFIX = "E2E platform surface";
const feedPostTitle = `${TITLE_PREFIX} chapter update`;

test.describe("platform surfaces for linked CSF members", () => {
  let fixture: CsfFeedFixture;

  test.beforeAll(async () => {
    fixture = await loadCsfFeedFixture();
    await cleanFeedPosts(fixture, TITLE_PREFIX);
    await seedFeedPosts(fixture, [
      {
        title: feedPostTitle,
        body: "Fictional chapter-wide update surfaced on the platform home feed.",
        audience: "members",
      },
    ]);
  });

  test.afterAll(async () => {
    if (fixture) await cleanFeedPosts(fixture, TITLE_PREFIX);
  });

  test("/home shows the organization feed section with the CSF post", async ({
    page,
  }) => {
    await loginAs(page, "member", "/home");

    // React streaming can leave a hidden duplicate of the suspended section
    // in the document; assert against the visible instance.
    const section = page
      .locator("[data-tour-id='home-plugin-feed']")
      .filter({ visible: true });
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("heading", { name: "From your organizations" }),
    ).toBeVisible();

    const item = section
      .locator('[data-slot="card"]')
      .filter({ hasText: feedPostTitle });
    await expect(item).toHaveCount(1);
    await expect(item.getByText("DVHS CSF", { exact: true })).toBeVisible();
    const postLink = item.getByRole("link", { name: feedPostTitle });
    await expect(postLink).toHaveAttribute(
      "href",
      /\/organization\/dvhs-csf\/plugins\/dvhs-csf\/home$/,
    );
  });

  test("/dashboard Overview shows the CSF card for the linked member", async ({
    page,
  }) => {
    await loginAs(page, "member", "/dashboard");

    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("DVHS CSF", { exact: true }) })
      .first();
    await expect(card).toBeVisible();
    const open = card.getByRole("link", { name: "Open" });
    await expect(open).toHaveAttribute(
      "href",
      /\/organization\/dvhs-csf\/plugins\/dvhs-csf\/home$/,
    );
  });

  test("a user outside the CSF organization sees neither surface", async ({
    page,
  }) => {
    await loginAs(page, "outsider", "/home");
    await expect(
      page.locator("[data-tour-id='home-plugin-feed']"),
    ).toHaveCount(0);
    await expect(page.getByText("From your organizations")).toHaveCount(0);
    await expect(page.getByText(feedPostTitle)).toHaveCount(0);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Volunteer Dashboard" }),
    ).toBeVisible();
    await expect(page.getByText("DVHS CSF", { exact: true })).toHaveCount(0);
  });
});
