import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  cleanFeedActivities,
  loadCsfFeedFixture,
  type CsfFeedFixture,
} from "./feed-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

/**
 * Publication saves the officer's email choice and frozen announcement in the
 * same transaction as the activity. The isolated runner keeps outbound workers
 * disabled, so this spec verifies the durable intent before campaign preparation.
 * Fictional activities are removed after each test. No provider is called.
 */

const TITLE_PREFIX = "E2E Activity Lifecycle";
const OFFICER_PATH = `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_service=opportunities`;
const MEMBER_FEED_PATH = `${CSF_ORGANIZATION_PATH}?tab=csf-home`;

/**
 * Publication can report saved intent or queue state, never an unobserved
 * provider delivery.
 */
const DELIVERY_CLAIMS = /\b(delivered|arrived|received by|inbox)\b/iu;

type SeededActivity = { id: string; title: string };

async function seedDraftActivity(
  fixture: CsfFeedFixture,
  title: string,
): Promise<SeededActivity> {
  const { data, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_opportunities")
    .insert({
      organization_id: fixture.organizationId,
      term_id: fixture.currentTermId,
      title,
      body: "Fictional synthetic activity for the lifecycle acceptance spec.",
      starts_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      location: "Fictional Library",
      point_value: 1,
      point_type: "non_drive",
      signup_mode: "none",
      requires_point_submission: false,
      status: "draft",
    })
    .select("id, title")
    .single();
  if (error || !data) {
    throw new Error(
      `Could not seed the fictional draft activity: ${error?.message ?? "no row"}`,
    );
  }
  return { id: String(data.id), title: String(data.title) };
}

async function storedActivity(fixture: CsfFeedFixture, activityId: string) {
  const { data, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_opportunities")
    .select("id, status, published_at")
    .eq("organization_id", fixture.organizationId)
    .eq("id", activityId)
    .single();
  if (error || !data) {
    throw new Error(
      `Could not read the fictional activity: ${error?.message ?? "no row"}`,
    );
  }
  return data as { id: string; status: string; published_at: string | null };
}

/** A campaign exists only after the saved announcement has been prepared. */
async function campaignFor(fixture: CsfFeedFixture, activityId: string) {
  const { data, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_communication_campaigns")
    .select("id, status, source_activity_id")
    .eq("organization_id", fixture.organizationId)
    .eq("source_activity_id", activityId);
  if (error) {
    throw new Error(`Could not read the fictional campaign: ${error.message}`);
  }
  return data ?? [];
}

async function emailIntentFor(fixture: CsfFeedFixture, activityId: string) {
  const { data, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_publication_events")
    .select(
      "id, activity_email_requested, activity_email_state, activity_email_request_id, activity_email_snapshot, activity_email_campaign_id, activity_email_error_code",
    )
    .eq("organization_id", fixture.organizationId)
    .eq("source_kind", "activity")
    .eq("source_id", activityId);
  if (error) {
    throw new Error(
      `Could not read the fictional email intent: ${error.message}`,
    );
  }
  expect(data).toHaveLength(1);
  return data![0];
}

async function openActivity(page: Page, activity: SeededActivity) {
  await page.goto(
    `${OFFICER_PATH}&csf_activity=${encodeURIComponent(activity.id)}`,
    { waitUntil: "domcontentloaded" },
  );
  const actions = page.getByRole("button", {
    name: `Actions for ${activity.title}`,
  });
  await expect(actions).toBeVisible();
  return actions;
}

test.describe("CSF activity publication lifecycle", () => {
  let fixture: CsfFeedFixture;
  let activity: SeededActivity;

  test.beforeAll(async () => {
    fixture = await loadCsfFeedFixture();
  });

  test.beforeEach(async () => {
    activity = await seedDraftActivity(
      fixture,
      `${TITLE_PREFIX} ${randomUUID().slice(0, 8)}`,
    );
  });

  test.afterEach(async () => {
    await cleanFeedActivities(fixture, TITLE_PREFIX);
  });

  test("an officer publishes a draft and the result never claims delivery", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "activityCoordinator");

    const actions = await openActivity(page, activity);
    await actions.click();
    await page.getByRole("menuitem", { name: "Publish", exact: true }).click();

    const dialog = page.getByRole("dialog", {
      name: `Publish ${activity.title}?`,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "Save one announcement with this publication.",
    );
    expect(await dialog.innerText()).not.toMatch(DELIVERY_CLAIMS);
    const emailBox = dialog.getByRole("checkbox", {
      name: "Also email members",
    });
    await expect(emailBox).toBeChecked();

    await dialog.getByRole("button", { name: "Publish activity" }).click();
    await expect(dialog).toBeHidden();

    const banner = page.getByText(/Activity published\./);
    await expect(banner).toBeVisible();
    const outcome = await banner.innerText();
    expect(outcome).not.toMatch(DELIVERY_CLAIMS);

    const stored = await storedActivity(fixture, activity.id);
    expect(stored.status).toBe("published");
    expect(stored.published_at).not.toBeNull();

    const intent = await emailIntentFor(fixture, activity.id);
    expect(intent.activity_email_requested).toBe(true);
    expect(intent.activity_email_request_id).not.toBeNull();
    expect(intent.activity_email_snapshot.sourceSnapshot.id).toBe(activity.id);
    expect(intent.activity_email_snapshot.sourceSnapshot.title).toBe(
      activity.title,
    );
    expect(intent.activity_email_snapshot.sourceSnapshot.body).toBe(
      "Fictional synthetic activity for the lifecycle acceptance spec.",
    );
    expect(Array.isArray(intent.activity_email_snapshot.recipients)).toBe(true);
    expect(intent.activity_email_snapshot.topic.topicKey).toBeTruthy();

    if (intent.activity_email_snapshot.recipients.length > 0) {
      expect(intent.activity_email_state).toBe("pending");
      expect(intent.activity_email_error_code).toBeNull();
      expect(outcome).toContain("Its announcement is saved for preparation.");
    } else {
      expect(intent.activity_email_state).toBe("blocked");
      expect(intent.activity_email_error_code).toBe("no_recipients");
      expect(outcome).toContain("Its announcement needs review.");
    }
    // Disabled outbound workers cannot turn the saved intent into a campaign.
    expect(intent.activity_email_campaign_id).toBeNull();
    expect(await campaignFor(fixture, activity.id)).toEqual([]);

    expectNoBrowserFailures(failures);
  });

  test("publishing without the email box queues nothing", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "activityCoordinator");

    const actions = await openActivity(page, activity);
    await actions.click();
    await page.getByRole("menuitem", { name: "Publish", exact: true }).click();

    const dialog = page.getByRole("dialog", {
      name: `Publish ${activity.title}?`,
    });
    await dialog
      .getByRole("checkbox", { name: "Also email members" })
      .uncheck();
    await dialog.getByRole("button", { name: "Publish activity" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(/Activity published\./)).toBeVisible();
    expect((await storedActivity(fixture, activity.id)).status).toBe(
      "published",
    );
    expect(await campaignFor(fixture, activity.id)).toEqual([]);
    const intent = await emailIntentFor(fixture, activity.id);
    expect(intent.activity_email_requested).toBe(false);
    expect(intent.activity_email_state).toBe("not_requested");
    expect(intent.activity_email_snapshot).toBeNull();
    expect(intent.activity_email_campaign_id).toBeNull();
    await expect(page.getByText(/Activity published\./)).toContainText(
      "No announcement requested.",
    );

    expectNoBrowserFailures(failures);
  });

  test("a published activity reaches the member stream and can be closed", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "activityCoordinator");

    const actions = await openActivity(page, activity);
    await actions.click();
    await page.getByRole("menuitem", { name: "Publish", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: `Publish ${activity.title}?`,
    });
    await dialog
      .getByRole("checkbox", { name: "Also email members" })
      .uncheck();
    await dialog.getByRole("button", { name: "Publish activity" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Activity published\./)).toBeVisible();

    // The member side of publication: the unified stream, not a mailbox.
    const memberPage = await page.context().browser()!.newPage();
    try {
      await loginAs(memberPage, "member");
      await memberPage.goto(MEMBER_FEED_PATH, {
        waitUntil: "domcontentloaded",
      });
      await expect(memberPage.getByText(activity.title).first()).toBeVisible();
      const activityLink = memberPage.getByRole("link", {
        name: activity.title,
        exact: true,
      });
      await expect(activityLink).toHaveCount(1);
      await activityLink.focus();
      await memberPage.keyboard.press("Enter");
      await expect(memberPage).toHaveURL(
        new RegExp(`csf_activity=${activity.id}`),
      );
      await memberPage.goto(MEMBER_FEED_PATH);
      const card = memberPage.locator("article").filter({
        has: memberPage.getByRole("link", {
          name: activity.title,
          exact: true,
        }),
      });
      await expect(card.getByRole("button")).toHaveCount(0);
      await card.click({ position: { x: 8, y: 8 } });
      await expect(memberPage).toHaveURL(
        new RegExp(`csf_activity=${activity.id}`),
      );
    } finally {
      await memberPage.close();
    }

    const publishedActions = await openActivity(page, activity);
    await publishedActions.click();
    await page
      .getByRole("menuitem", { name: "Close signups", exact: true })
      .click();

    // The persistent status, not the toast. "Activity marked closed." is a
    // transient success message that can expire before this line runs, which
    // failed the test on a change the page had already made. What an officer
    // has to be able to come back to is the status on the activity itself.
    await expect(page.getByText("Signups closed")).toBeVisible();
    expect((await storedActivity(fixture, activity.id)).status).toBe("closed");

    expectNoBrowserFailures(failures);
  });

  test("a member never sees the activity status controls", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "member");

    await page.goto(
      `${OFFICER_PATH}&csf_activity=${encodeURIComponent(activity.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: `Actions for ${activity.title}` }),
    ).toHaveCount(0);
    // A draft is officer state; the member surface must not render it either.
    await expect(page.getByText(activity.title)).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });
});
