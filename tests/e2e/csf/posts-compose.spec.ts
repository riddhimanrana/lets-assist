import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

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
const PLUGIN_KEY = "dvhs-csf";
const composedTitle = `${TITLE_PREFIX} spring class update ${randomUUID()}`;
const composedBody =
  "Fictional class announcement composed by the browser suite. No real students are addressed.";
// The fixture helper removes replies through the canonical audited RPC before
// deleting their RESTRICT-protected announcement.
const composedReply =
  "Follow-up from the browser suite: room moved to the fictional annex.";

// Regressions caught: post success hidden by auto-close; unchecked email
// ambiguously reported; queue intent confused with provider delivery.
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
    const publicationResult = dialog.getByRole("status", {
      name: "Post publication result",
    });
    await expect(publicationResult).toContainText("Post published.");
    await expect(publicationResult).toContainText("Email not queued");
    await expect(
      dialog.getByRole("button", { name: "Publish post" }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Acknowledge result" }).click();
    await expect(dialog).toBeHidden();

    // The mutation is durable server-side; a reload proves the Stream renders
    // the published post with its compose-side status.
    await expect
      .poll(async () => {
        const { data, error } = await fixture.admin
          .schema("plugin_data")
          .from("csf_announcements")
          .select(
            "id, status, audience, audience_cohort_id, pinned, email_requested, email_campaign_id",
          )
          .eq("organization_id", fixture.organizationId)
          .eq("title", composedTitle)
          .maybeSingle();
        if (error) {
          throw new Error(
            `Could not load the unchecked announcement: ${error.message}`,
          );
        }
        return data;
      })
      .toEqual({
        id: expect.any(String),
        status: "published",
        audience: "class",
        audience_cohort_id: fixture.cohortIdsByYear[2028],
        pinned: false,
        email_requested: false,
        email_campaign_id: null,
      });
    const { data: noEmailAnnouncement, error: noEmailAnnouncementError } =
      await fixture.admin
        .schema("plugin_data")
        .from("csf_announcements")
        .select("id")
        .eq("organization_id", fixture.organizationId)
        .eq("title", composedTitle)
        .single();
    if (noEmailAnnouncementError || !noEmailAnnouncement) {
      throw new Error(
        `Could not reload the unchecked announcement: ${noEmailAnnouncementError?.message ?? "missing announcement"}`,
      );
    }
    const { data: noEmailCampaigns, error: noEmailCampaignsError } =
      await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_campaigns")
        .select("id")
        .eq("organization_id", fixture.organizationId)
        .eq("source_announcement_id", noEmailAnnouncement.id);
    if (noEmailCampaignsError) {
      throw new Error(
        `Could not check unchecked announcement campaigns: ${noEmailCampaignsError.message}`,
      );
    }
    expect(noEmailCampaigns).toEqual([]);

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

  test("an officer sees queued email as ledger work, not provider delivery", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    const queuedTitle = `${TITLE_PREFIX} queued ${randomUUID()}`;
    const queuedBody =
      "Fictional namespaced announcement proving a queued CSF email without provider dispatch.";
    let originalConfiguration: Record<string, unknown> | null = null;
    let queuedCampaignId: string | null = null;
    let testFailure: Error | null = null;
    const cleanupFailures: Error[] = [];
    const recordCleanupFailure = (message: string, error?: unknown) => {
      cleanupFailures.push(
        error instanceof Error
          ? new Error(`${message}: ${error.message}`)
          : new Error(message),
      );
    };

    try {
      const { data: install, error: installError } = await fixture.admin
        .from("organization_plugin_installs")
        .select("configuration")
        .eq("organization_id", fixture.organizationId)
        .eq("plugin_key", PLUGIN_KEY)
        .eq("enabled", true)
        .single();
      if (installError || !install) {
        throw new Error(
          `Could not load the isolated CSF plugin configuration: ${installError?.message ?? "missing install"}`,
        );
      }
      const savedConfiguration: Record<string, unknown> =
        install.configuration &&
        typeof install.configuration === "object" &&
        !Array.isArray(install.configuration)
          ? structuredClone(install.configuration)
          : {};
      originalConfiguration = savedConfiguration;
      const configured = structuredClone(savedConfiguration);
      const communications: Record<string, unknown> =
        configured.communications &&
        typeof configured.communications === "object" &&
        !Array.isArray(configured.communications)
          ? structuredClone(
              configured.communications as Record<string, unknown>,
            )
          : {};
      const broadcastTopics: Record<string, unknown> =
        communications.broadcastTopics &&
        typeof communications.broadcastTopics === "object" &&
        !Array.isArray(communications.broadcastTopics)
          ? structuredClone(
              communications.broadcastTopics as Record<string, unknown>,
            )
          : {};
      const topicSuffix = randomUUID().replaceAll("-", "");
      broadcastTopics.term_members = {
        topicKey: `e2e-compose-${topicSuffix}`,
        resendTopicId: `topic_e2e_compose_${topicSuffix}`,
      };
      configured.communications = { ...communications, broadcastTopics };
      const { error: configureError } = await fixture.admin
        .from("organization_plugin_installs")
        .update({ configuration: configured })
        .eq("organization_id", fixture.organizationId)
        .eq("plugin_key", PLUGIN_KEY);
      if (configureError) {
        throw new Error(
          `Could not configure the synthetic term_members topic: ${configureError.message}`,
        );
      }

      await loginAs(page, "admin");
      await page.goto(
        `${CSF_ORGANIZATION_PATH}?tab=csf-cohorts&csf_cohort=${fixture.cohortIdsByYear[2028]}&csf_cohort_tab=stream`,
        { waitUntil: "domcontentloaded" },
      );
      const stream = page.getByRole("region", { name: "Class stream" });
      await stream
        .getByRole("button", { name: "Announce something to Class of 2028" })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Title").fill(queuedTitle);
      await dialog.getByLabel("Message").fill(queuedBody);
      await dialog
        .getByRole("checkbox", { name: "Also send this as an email" })
        .check();
      await dialog.getByRole("button", { name: "Publish post" }).click();

      const publicationResult = dialog.getByRole("status", {
        name: "Post publication result",
      });
      await expect(publicationResult).toContainText("Post published.");
      await expect(publicationResult).toContainText("Email queued");
      await expect(
        dialog.getByRole("button", { name: "Publish post" }),
      ).toBeDisabled();

      const { data: announcement, error: announcementError } =
        await fixture.admin
          .schema("plugin_data")
          .from("csf_announcements")
          .select("id, email_requested, email_campaign_id")
          .eq("organization_id", fixture.organizationId)
          .eq("title", queuedTitle)
          .single();
      if (announcementError || !announcement?.email_campaign_id) {
        throw new Error(
          `Could not load the queued announcement receipt: ${announcementError?.message ?? "missing campaign link"}`,
        );
      }
      expect(announcement.email_requested).toBe(true);
      queuedCampaignId = announcement.email_campaign_id;

      const { data: term, error: termError } = await fixture.admin
        .schema("plugin_data")
        .from("csf_terms")
        .select("id")
        .eq("organization_id", fixture.organizationId)
        .eq("is_current", true)
        .single();
      if (termError || !term) {
        throw new Error(
          `Could not load the current CSF term: ${termError?.message ?? "missing term"}`,
        );
      }
      const { data: campaign, error: campaignError } = await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_campaigns")
        .select(
          "id, source_announcement_id, status, term_id, audience_kind, audience_cohort_id, content_finalized_at, audience_finalized_at, audience_size",
        )
        .eq("organization_id", fixture.organizationId)
        .eq("id", queuedCampaignId)
        .single();
      if (campaignError || !campaign) {
        throw new Error(
          `Could not load the queued campaign: ${campaignError?.message ?? "missing campaign"}`,
        );
      }
      expect(campaign).toMatchObject({
        id: queuedCampaignId,
        source_announcement_id: announcement.id,
        status: "queued",
        term_id: term.id,
        audience_kind: "cohort_members",
        audience_cohort_id: fixture.cohortIdsByYear[2028],
        content_finalized_at: expect.any(String),
        audience_finalized_at: expect.any(String),
      });

      const { data: snapshots, error: snapshotsError } = await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_recipient_snapshots")
        .select("id, campaign_id, profile_id, subscription_decision")
        .eq("organization_id", fixture.organizationId)
        .eq("campaign_id", queuedCampaignId);
      expect(snapshotsError).toBeNull();
      expect(snapshots?.length).toBe(campaign.audience_size);
      expect(snapshots?.every((snapshot) => snapshot.profile_id !== null)).toBe(
        true,
      );
      expect(
        snapshots?.every(
          (snapshot) =>
            snapshot.campaign_id === queuedCampaignId &&
            snapshot.subscription_decision === "included",
        ),
      ).toBe(true);

      const { data: deliveries, error: deliveriesError } = await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_deliveries")
        .select("id, status, provider_message_id, sent_at, delivered_at")
        .eq("organization_id", fixture.organizationId)
        .eq("campaign_id", queuedCampaignId);
      expect(deliveriesError).toBeNull();
      expect(deliveries?.length).toBe(campaign.audience_size);
      expect(
        deliveries?.every(
          (delivery) =>
            delivery.status === "queued" &&
            delivery.provider_message_id === null &&
            delivery.sent_at === null &&
            delivery.delivered_at === null,
        ),
      ).toBe(true);

      const { data: attempts, error: attemptsError } = await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_dispatch_attempts")
        .select(
          "id, state, provider_message_id, dispatch_authorized_at, dispatch_authorized_to, settled_at",
        )
        .eq("organization_id", fixture.organizationId)
        .eq("campaign_id", queuedCampaignId);
      expect(attemptsError).toBeNull();
      expect(attempts?.length).toBe(campaign.audience_size);
      expect(
        attempts?.every(
          (attempt) =>
            attempt.state === "queued" &&
            attempt.provider_message_id === null &&
            attempt.dispatch_authorized_at === null &&
            attempt.dispatch_authorized_to === null &&
            attempt.settled_at === null,
        ),
      ).toBe(true);
      const { data: providerEvents, error: providerEventsError } =
        await fixture.admin
          .schema("plugin_data")
          .from("csf_communication_provider_events")
          .select("id")
          .eq("organization_id", fixture.organizationId)
          .in(
            "attempt_id",
            (attempts ?? []).map((attempt) => attempt.id),
          );
      expect(providerEventsError).toBeNull();
      expect(providerEvents).toEqual([]);

      await dialog.getByRole("button", { name: "Acknowledge result" }).click();
      await expect(dialog).toBeHidden();
      expectNoBrowserFailures(failures);
    } catch (error) {
      testFailure = error instanceof Error ? error : new Error(String(error));
    } finally {
      let campaignIdForCleanup = queuedCampaignId;
      if (!campaignIdForCleanup) {
        const { data: queuedAnnouncement, error: recoveryError } =
          await fixture.admin
            .schema("plugin_data")
            .from("csf_announcements")
            .select("id, body, email_campaign_id")
            .eq("organization_id", fixture.organizationId)
            .eq("title", queuedTitle)
            .maybeSingle();
        if (recoveryError) {
          recordCleanupFailure(
            "Could not recover the synthetic announcement for campaign cleanup",
            recoveryError,
          );
        } else if (queuedAnnouncement) {
          if (!queuedAnnouncement.body.includes(queuedBody)) {
            recordCleanupFailure(
              "Recovered announcement did not match the synthetic body marker",
            );
          } else if (queuedAnnouncement.email_campaign_id) {
            campaignIdForCleanup = queuedAnnouncement.email_campaign_id;
          } else {
            recordCleanupFailure(
              "Recovered synthetic announcement has no campaign link to cancel",
            );
          }
        }
      }
      if (campaignIdForCleanup) {
        const { error: cancelError } = await fixture.admin
          .schema("plugin_data")
          .rpc("csf_cancel_communication_campaign", {
            p_organization_id: fixture.organizationId,
            p_campaign_id: campaignIdForCleanup,
            p_reason: "Synthetic browser acceptance cleanup.",
            p_actor_user_id: fixture.organizationAdminUserId,
            p_correlation_id: randomUUID(),
          });
        if (cancelError) {
          recordCleanupFailure(
            "Could not cancel the synthetic campaign",
            cancelError,
          );
        }
      }
      try {
        await cleanFeedPosts(fixture, queuedTitle);
      } catch (error) {
        recordCleanupFailure("Could not clean the synthetic post", error);
      }
      if (originalConfiguration) {
        const { error: restoreError } = await fixture.admin
          .from("organization_plugin_installs")
          .update({ configuration: originalConfiguration })
          .eq("organization_id", fixture.organizationId)
          .eq("plugin_key", PLUGIN_KEY);
        if (restoreError) {
          recordCleanupFailure(
            "Could not restore the isolated CSF plugin configuration",
            restoreError,
          );
        }
      }
    }
    if (cleanupFailures.length > 0) {
      if (testFailure) {
        throw new AggregateError(
          [testFailure, ...cleanupFailures],
          "CSF queued-email acceptance and cleanup failed",
        );
      }
      throw new AggregateError(
        cleanupFailures,
        "CSF queued-email acceptance cleanup failed",
      );
    }
    if (testFailure) throw testFailure;
  });
});
