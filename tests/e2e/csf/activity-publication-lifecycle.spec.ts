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
 * Activity lifecycle in the browser. An officer takes a draft to published with
 * an email request, a member sees the published activity, the officer closes
 * signups, and a member never gets the officer controls.
 *
 * Amendment 3 makes "queue is not delivery" a release boundary. The publish
 * dialog promises a queue ("Queue one announcement email after publication"),
 * and the result banner has to keep that promise. It may say the email was
 * queued or say plainly that it was not. It may never claim the message
 * arrived. The assertions check the officer-visible string rather than an
 * internal flag, since the string is what the contract constrains.
 *
 * The refusal classifier is not driven from here. Reproducing it needs a
 * committed attempt whose response was lost, followed by a state change before
 * the retry. That race cannot be staged reliably in a browser, and a flaky
 * acceptance spec is worse than none. That boundary is covered by
 * `lib/plugins/private/plugins/dvhs-csf/services/activity-action-refusals.test.ts`
 * and `.../server/actions/activity-definitive-refusal.test.ts`.
 *
 * Every row is fictional, carries this spec's own title prefix, and is removed
 * afterwards. Nothing reaches a real provider. The isolated runner keeps
 * outbound workers disabled, so a queued campaign stays queued.
 */

const TITLE_PREFIX = "E2E Activity Lifecycle";
const OFFICER_PATH = `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_service=opportunities`;
const MEMBER_FEED_PATH = `${CSF_ORGANIZATION_PATH}?tab=csf-home`;

/**
 * Copy that would claim a provider outcome the app has not observed. "Queued"
 * is the only thing publication can truthfully assert.
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

/** The durable campaign a publish-with-email request should have created. */
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
    // The dialog promises a queue, not an arrival. Publication copy has to
    // stay inside that promise.
    await expect(dialog).toContainText(
      "Queue one announcement email after publication.",
    );
    const emailBox = dialog.getByRole("checkbox", {
      name: "Also email members",
    });
    await expect(emailBox).toBeChecked();

    await dialog.getByRole("button", { name: "Publish activity" }).click();
    await expect(dialog).toBeHidden();

    const banner = page.getByText(/Activity published\./);
    await expect(banner).toBeVisible();
    const outcome = await banner.innerText();
    // Either truthful answer is fine, since the isolated stack may or may not
    // have a consent topic configured. Silence about the email, or a claim that
    // it arrived, is not.
    expect(outcome).toMatch(/Email (queued for|not queued:)/u);
    expect(outcome).not.toMatch(DELIVERY_CLAIMS);

    const stored = await storedActivity(fixture, activity.id);
    expect(stored.status).toBe("published");
    expect(stored.published_at).not.toBeNull();

    // Whatever the banner said has to agree with the ledger. A queued claim
    // means a durable campaign row exists. A "not queued" claim means none.
    const campaigns = await campaignFor(fixture, activity.id);
    expect(campaigns.length).toBe(outcome.includes("Email queued for") ? 1 : 0);

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
    } finally {
      await memberPage.close();
    }

    const publishedActions = await openActivity(page, activity);
    await publishedActions.click();
    await page
      .getByRole("menuitem", { name: "Close signups", exact: true })
      .click();
    await expect(page.getByText(/Activity marked closed\./)).toBeVisible();
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
