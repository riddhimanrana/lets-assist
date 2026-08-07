import { expect, test } from "@playwright/test";

import {
  cleanFeedPosts,
  loadCsfFeedFixture,
  type CsfFeedFixture,
} from "./feed-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const TITLE_PREFIX = "E2E compose";
const composedTitle = `${TITLE_PREFIX} spring class update`;
const composedBody =
  "Fictional class announcement composed by the browser suite. No real students are addressed.";

test.describe("officer post compose in the class Stream", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: CsfFeedFixture;

  test.beforeAll(async () => {
    fixture = await loadCsfFeedFixture();
    await cleanFeedPosts(fixture, TITLE_PREFIX);
  });

  test.afterAll(async () => {
    if (fixture) await cleanFeedPosts(fixture, TITLE_PREFIX);
  });

  test("an organization admin composes and pins a published class post", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin");

    // Classes tab -> class picker -> Class of 2028 workspace (Stream default).
    await page.getByRole("tab", { name: "Classes", exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=csf-cohorts(?:&|$)/);
    await page.getByRole("link", { name: "Class of 2028", exact: true }).click();
    await expect(page).toHaveURL(/[?&]csf_cohort=/);

    const workspaceTabs = page.getByRole("navigation", {
      name: "Class workspace tabs",
    });
    await expect(workspaceTabs).toBeVisible();
    // The tab controls are Button-rendered links; their accessible role is
    // reported as button in this tree, so assert by name within the nav.
    for (const tab of ["Stream", "Members", "Points", "Meetings"]) {
      await expect(
        workspaceTabs.getByRole("button", { name: tab, exact: true }),
      ).toBeVisible();
    }
    const stream = page.getByRole("region", { name: "Class stream" });
    await expect(stream).toBeVisible();

    // Compose: the dialog arrives preseeded to this class's audience.
    await stream.getByRole("button", { name: "New post", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Write a post" }),
    ).toBeVisible();
    await expect(dialog.getByText("One graduating class")).toBeVisible();
    await expect(dialog.getByText("Class of 2028")).toBeVisible();

    await dialog.getByLabel("Title").fill(composedTitle);
    await dialog.getByLabel("Message").fill(composedBody);

    // The email decision exists but stays off for this scenario.
    const emailToggle = dialog.getByRole("checkbox", {
      name: /Also send as email to that class/,
    });
    await expect(emailToggle).toBeVisible();
    await expect(emailToggle).not.toBeChecked();

    await dialog.getByRole("button", { name: "Publish post" }).click();
    await expect(dialog).toBeHidden();

    // The mutation is durable server-side; a reload proves the Stream renders
    // the published post with its compose-side status.
    await expect
      .poll(async () => {
        const { data } = await fixture.admin
          .schema("plugin_data")
          .from("csf_announcements")
          .select("status, audience, audience_cohort_id, pinned")
          .eq("organization_id", fixture.organizationId)
          .eq("title", composedTitle)
          .maybeSingle();
        return data;
      })
      .toEqual({
        status: "published",
        audience: "class",
        audience_cohort_id: fixture.cohortIdsByYear[2028],
        pinned: false,
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    const composedEntry = page
      .getByRole("region", { name: "Class stream" })
      .locator("> div")
      .filter({ hasText: composedTitle });
    await expect(composedEntry).toHaveCount(1);
    await expect(
      composedEntry.getByText("published", { exact: true }),
    ).toBeVisible();
    await expect(
      composedEntry.getByText("Class of 2028", { exact: true }),
    ).toBeVisible();

    // Pin it from the Stream controls.
    await composedEntry.getByRole("button", { name: "Pin", exact: true }).click();
    await expect
      .poll(async () => {
        const { data } = await fixture.admin
          .schema("plugin_data")
          .from("csf_announcements")
          .select("pinned")
          .eq("organization_id", fixture.organizationId)
          .eq("title", composedTitle)
          .maybeSingle();
        return data?.pinned ?? null;
      })
      .toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    const pinnedEntry = page
      .getByRole("region", { name: "Class stream" })
      .locator("> div")
      .filter({ hasText: composedTitle });
    await expect(pinnedEntry.getByText("Pinned", { exact: true })).toBeVisible();
    await expect(
      pinnedEntry.getByRole("button", { name: "Unpin", exact: true }),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });

  test("the member Home feed shows the officer's post pinned", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "member");

    const feed = page.getByRole("region", { name: "CSF posts" });
    await expect(feed).toBeVisible();
    const post = feed.locator("[data-post-id]").filter({ hasText: composedTitle });
    await expect(post).toHaveCount(1);
    await expect(post.getByText("Pinned", { exact: true })).toBeVisible();
    await expect(
      post.getByText("Class of 2028", { exact: true }),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });

  test("a member-role account has no compose affordance anywhere", async ({
    page,
  }) => {
    await loginAs(page, "member");

    await expect(
      page.getByRole("tab", { name: "Home", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New post", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Classes", exact: true }),
    ).toHaveCount(0);

    // The staff cohorts route stays a hard 404 for member accounts.
    const response = await page.goto(
      `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/cohorts`,
    );
    expect(response?.status()).toBe(404);
  });
});
