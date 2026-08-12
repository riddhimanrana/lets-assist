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
// The fixture helper removes replies through the canonical audited RPC before
// deleting their RESTRICT-protected announcement.
const composedReply =
  "Follow-up from the browser suite: room moved to the fictional annex.";

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
    await page
      .getByRole("link", { name: "Class of 2028", exact: true })
      .click();
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

    // Compose: the composer row opens the dialog, preseeded to this class's
    // audience. The row names the class it posts to rather than the action.
    await stream
      .getByRole("button", { name: "Announce something to Class of 2028" })
      .click();
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
      name: "Also send this as an email",
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
      .getByRole("article")
      .filter({ hasText: composedTitle });
    await expect(composedEntry).toHaveCount(1);
    // Published is the Stream's expected state and deliberately carries no
    // badge; the states an officer still has to act on are the ones that do.
    await expect(composedEntry.getByText("Draft", { exact: true })).toHaveCount(
      0,
    );
    await expect(composedEntry.getByText(/^Scheduled/)).toHaveCount(0);
    await expect(composedEntry).toContainText("Class of 2028");

    // Pin it from the Stream controls.
    await composedEntry
      .getByRole("button", { name: "Pin post", exact: true })
      .click();
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
      .getByRole("article")
      .filter({ hasText: composedTitle });
    await expect(
      pinnedEntry.getByText("Pinned", { exact: true }),
    ).toBeVisible();
    await expect(
      pinnedEntry.getByRole("button", { name: "Unpin post", exact: true }),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });

  test("an officer appends a follow-up reply from the Stream card", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin");
    await page.goto(
      `${CSF_ORGANIZATION_PATH}?tab=csf-cohorts&csf_cohort=${fixture.cohortIdsByYear[2028]}&csf_cohort_tab=stream`,
      { waitUntil: "domcontentloaded" },
    );

    const stream = page.getByRole("region", { name: "Class stream" });
    await expect(stream).toBeVisible();
    const card = stream.getByRole("article").filter({ hasText: composedTitle });
    await expect(card).toHaveCount(1);

    // Retry the disclosure as one block: the first click can land before the
    // stream hydrates, and a pre-hydration click is silently lost.
    await expect(async () => {
      await card.getByRole("button", { name: "Add a follow-up" }).click();
      await expect(card.getByLabel("Follow-up message")).toBeVisible({
        timeout: 2_000,
      });
    }).toPass();
    await card.getByLabel("Follow-up message").fill(composedReply);
    await card.getByRole("button", { name: "Post follow-up" }).click();
    // The optimistic row appears at once; the durable write follows.
    await expect(card.getByText(composedReply, { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const { data } = await fixture.admin
          .schema("plugin_data")
          .from("csf_announcement_replies")
          .select("id")
          .eq("organization_id", fixture.organizationId)
          .eq("body", composedReply);
        return data?.length ?? 0;
      })
      .toBe(1);

    expectNoBrowserFailures(failures);
  });

  test("the member Home feed shows the officer's post pinned with its reply", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "member");

    const feed = page.getByRole("region", { name: "Class feed" });
    await expect(feed).toBeVisible();
    const post = feed.getByRole("article").filter({ hasText: composedTitle });
    await expect(post).toHaveCount(1);
    await expect(post.getByText("Pinned", { exact: true })).toBeVisible();
    await expect(post).toContainText("Class of 2028");
    // The officer's follow-up rides inside the card, read-only for members.
    await expect(post.getByText(composedReply, { exact: true })).toBeVisible();
    await expect(
      post.getByRole("button", { name: "Add a follow-up" }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("a member-role account has no compose affordance anywhere", async ({
    page,
  }) => {
    await loginAs(page, "member");

    await expect(
      page.getByRole("tab", { name: "Feed", exact: true }),
    ).toBeVisible();
    // Neither compose entry point exists for a member: the Feed's "New
    // post" button nor the class Stream's click-to-open composer row.
    await expect(
      page.getByRole("button", { name: "New post", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Announce something to / }),
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
