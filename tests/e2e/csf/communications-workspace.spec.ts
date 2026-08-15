import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { loadCsfFeedFixture, type CsfFeedFixture } from "./feed-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const SUBJECT_PREFIX = "E2E communications workspace";
const PLUGIN_KEY = "dvhs-csf";
type StoredPluginConfiguration =
  | null
  | boolean
  | number
  | string
  | StoredPluginConfiguration[]
  | { [key: string]: StoredPluginConfiguration };

const AUDIENCE_FIELDSETS = [
  "Term members",
  "Applicants",
  "Partner representatives",
  "CSF staff",
] as const;

const terminalCampaignStatuses = new Set(["cancelled", "completed", "failed"]);

/**
 * Campaigns are immutable receipt history: cleanup withdraws any non-terminal
 * synthetic campaign through the same audited RPC the product uses and never
 * deletes campaign, snapshot, delivery, attempt, or audit rows.
 */
async function cancelSyntheticCampaigns(
  fixture: CsfFeedFixture,
  subjectPrefix: string,
) {
  const { data: campaigns, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_communication_campaigns")
    .select("id, status")
    .eq("organization_id", fixture.organizationId)
    .like("subject", `${subjectPrefix}%`);
  if (error) {
    throw new Error(
      `Could not load synthetic campaigns for safe cleanup: ${error.message}`,
    );
  }
  for (const campaign of campaigns ?? []) {
    if (terminalCampaignStatuses.has(campaign.status)) continue;
    const { data: cancellation, error: cancellationError } = await fixture.admin
      .schema("plugin_data")
      .rpc("csf_cancel_communication_campaign", {
        p_organization_id: fixture.organizationId,
        p_campaign_id: campaign.id,
        p_reason: "Synthetic browser acceptance cleanup.",
        p_actor_user_id: fixture.organizationAdminUserId,
        p_correlation_id: randomUUID(),
      });
    const cancellationStatus =
      cancellation &&
      typeof cancellation === "object" &&
      !Array.isArray(cancellation) &&
      cancellation.status;
    if (cancellationError || cancellationStatus !== "cancelled") {
      throw new Error(
        `Could not cancel synthetic campaign ${campaign.id}: ${cancellationError?.message ?? `status ${String(cancellationStatus)}`}`,
      );
    }
  }
}

async function loadPluginConfiguration(fixture: CsfFeedFixture) {
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
  return structuredClone(install.configuration) as StoredPluginConfiguration;
}

async function savePluginConfiguration(
  fixture: CsfFeedFixture,
  configuration: StoredPluginConfiguration,
) {
  // Target exactly the enabled install the loader read, and prove one row
  // matched so a silently missed write cannot pass as a restoration.
  const { data: updated, error } = await fixture.admin
    .from("organization_plugin_installs")
    .update({ configuration })
    .eq("organization_id", fixture.organizationId)
    .eq("plugin_key", PLUGIN_KEY)
    .eq("enabled", true)
    .select("organization_id");
  if (error || !updated?.length) {
    throw new Error(
      `Could not write the isolated CSF plugin configuration: ${error?.message ?? "no enabled install matched"}`,
    );
  }
}

function withTermMembersTopic(
  original: StoredPluginConfiguration,
  topicSuffix: string,
): StoredPluginConfiguration {
  const configured: Record<string, StoredPluginConfiguration> =
    original && typeof original === "object" && !Array.isArray(original)
      ? structuredClone(original)
      : {};
  const communications: Record<string, StoredPluginConfiguration> =
    configured.communications &&
    typeof configured.communications === "object" &&
    !Array.isArray(configured.communications)
      ? structuredClone(configured.communications)
      : {};
  const broadcastTopics: Record<string, StoredPluginConfiguration> =
    communications.broadcastTopics &&
    typeof communications.broadcastTopics === "object" &&
    !Array.isArray(communications.broadcastTopics)
      ? structuredClone(communications.broadcastTopics)
      : {};
  broadcastTopics.term_members = {
    topicKey: `e2e-communications-${topicSuffix}`,
    resendTopicId: `topic_e2e_communications_${topicSuffix}`,
  };
  configured.communications = { ...communications, broadcastTopics };
  return configured;
}

// Regressions caught: Communications reachable only by direct URL from the
// Settings hub; queue intent confused with provider delivery; cancellation
// losing its recorded reason or touching provider truth.
test.describe("CSF communications workspace", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: CsfFeedFixture;
  let originalConfiguration: StoredPluginConfiguration | null = null;
  let configurationWasSaved = false;

  test.beforeAll(async () => {
    fixture = await loadCsfFeedFixture();
    await cancelSyntheticCampaigns(fixture, SUBJECT_PREFIX);
  });

  // The stored-configuration restoration lives in lifecycle cleanup so a
  // timed-out test body cannot skip it: Playwright still runs afterEach after
  // a test timeout, and the hook claims its own timeout budget.
  test.afterEach(async () => {
    if (!configurationWasSaved) return;
    test.setTimeout(30_000);
    await savePluginConfiguration(fixture, originalConfiguration);
    configurationWasSaved = false;
    originalConfiguration = null;
  });

  test.afterAll(async () => {
    if (fixture) await cancelSyntheticCampaigns(fixture, SUBJECT_PREFIX);
  });

  test("an organization admin reaches Communications from the Settings hub", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin", `${CSF_ORGANIZATION_PATH}?tab=csf-settings`);

    // The hub lists one row per operational settings workspace. Its links are
    // Button-rendered anchors, whose accessible role is reported as button in
    // this tree (see posts-compose for the same convention).
    const settingsHub = page
      .locator('[data-slot="card"]')
      .filter({
        hasText:
          "Open the workspace where each operational setting is managed.",
      })
      .last();
    await expect(settingsHub).toBeVisible();
    await expect(
      settingsHub.getByRole("button", { name: "Imports", exact: true }),
    ).toBeVisible();
    await expect(
      settingsHub.getByRole("button", { name: "Semester", exact: true }),
    ).toBeVisible();
    await expect(
      settingsHub.getByText("Email campaigns and broadcast topics", {
        exact: true,
      }),
    ).toBeVisible();

    await settingsHub
      .getByRole("button", { name: "Communications", exact: true })
      .click();
    await expect(page).toHaveURL(/[?&]tab=csf-communications(?:&|$)/);
    await expect(page).toHaveURL(/[?&]csf_communications_view=settings(?:&|$)/);

    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Communications",
        exact: true,
      }),
    ).toBeVisible();
    const sections = page.getByRole("navigation", {
      name: "Communications sections",
    });
    await expect(sections).toBeVisible();
    // The Campaigns control carries its count badge in the accessible name, so
    // it is asserted by prefix rather than exact name.
    await expect(
      sections.getByRole("button", { name: "Campaigns" }),
    ).toBeVisible();
    await expect(
      sections.getByRole("button", { name: "Delivery issues", exact: true }),
    ).toBeVisible();
    await expect(
      sections.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();

    // The hub link lands directly on the stored-topic settings, one fieldset
    // per audience with both stored values labelled.
    await expect(
      page.getByText("Communications settings", { exact: true }),
    ).toBeVisible();
    for (const audience of AUDIENCE_FIELDSETS) {
      const fieldset = page.getByRole("group", { name: audience, exact: true });
      await expect(fieldset).toBeVisible();
      await expect(fieldset.getByLabel("Consent topic key")).toBeVisible();
      await expect(fieldset.getByLabel("Resend topic id")).toBeVisible();
    }

    await sections
      .getByRole("button", { name: "Delivery issues", exact: true })
      .click();
    await expect(page).toHaveURL(/[?&]csf_communications_view=delivery(?:&|$)/);
    await expect(
      page.getByRole("heading", {
        level: 3,
        name: "Delivery exceptions",
        exact: true,
      }),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });

  test("a co-president queues and cancels a broadcast at tablet size as ledger truth, never provider work", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    const runId = randomUUID();
    const subject = `${SUBJECT_PREFIX} ${runId}`;
    const bodyText =
      "Fictional broadcast drafted by the browser suite. No real recipients exist and no provider is contacted.";
    const cancelReason = `Synthetic browser-suite cancellation ${runId}`;
    let campaignId: string | null = null;

    originalConfiguration = await loadPluginConfiguration(fixture);
    configurationWasSaved = true;
    await savePluginConfiguration(
      fixture,
      withTermMembersTopic(originalConfiguration, runId.replaceAll("-", "")),
    );

    await loginAs(
      page,
      "coPresident",
      `${CSF_ORGANIZATION_PATH}?tab=csf-communications`,
    );
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Communications",
        exact: true,
      }),
    ).toBeVisible();

    // Draft through the real dialog: broadcast to term members of the
    // current term, both preselected defaults.
    await page.getByRole("button", { name: "New email" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(
      createDialog.getByRole("heading", { name: "New email" }),
    ).toBeVisible();
    await createDialog.getByLabel("Subject").fill(subject);
    await createDialog.getByLabel("Plain-text message").fill(bodyText);
    await createDialog
      .getByRole("button", { name: "Save and review recipients" })
      .click();
    await expect(createDialog).toBeHidden();

    const { data: draft, error: draftError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_communication_campaigns")
      .select("id, status, campaign_kind, audience_kind")
      .eq("organization_id", fixture.organizationId)
      .eq("subject", subject)
      .single();
    if (draftError || !draft) {
      throw new Error(
        `Could not load the drafted campaign: ${draftError?.message ?? "missing campaign"}`,
      );
    }
    expect(draft.status).toBe("draft");
    expect(draft.campaign_kind).toBe("broadcast");
    expect(draft.audience_kind).toBe("term_members");
    campaignId = draft.id;

    // The newest campaign is the selected one; its card owns every explicit
    // transition. The deepest card containing the subject is the detail card
    // (the history rail entry is a plain link).
    const campaignCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText(subject, { exact: true }) })
      .last();
    await expect(campaignCard).toBeVisible();

    await campaignCard
      .getByRole("button", { name: "Finalize content", exact: true })
      .click();
    const finalizeContentDialog = page.getByRole("dialog");
    await expect(
      finalizeContentDialog.getByRole("heading", {
        name: "Finalize this message?",
      }),
    ).toBeVisible();
    await finalizeContentDialog
      .getByRole("button", { name: "Finalize content", exact: true })
      .click();
    await expect(finalizeContentDialog).toBeHidden();

    await campaignCard
      .getByRole("button", { name: "Review recipients", exact: true })
      .click();
    const snapshotDialog = page.getByRole("dialog");
    await expect(
      snapshotDialog.getByRole("heading", {
        name: "Lock in who receives this email?",
      }),
    ).toBeVisible();
    await snapshotDialog
      .getByRole("button", { name: "Lock in recipients", exact: true })
      .click();
    await expect(snapshotDialog).toBeHidden();
    await expect(
      campaignCard.getByText(/\d+ included · \d+ excluded/),
    ).toBeVisible();

    await campaignCard
      .getByRole("button", { name: "Queue for sending", exact: true })
      .click();
    const queueDialog = page.getByRole("dialog");
    await expect(
      queueDialog.getByRole("heading", {
        name: "Queue this email for sending?",
      }),
    ).toBeVisible();
    await queueDialog
      .getByRole("button", { name: "Queue for sending", exact: true })
      .click();
    await expect(queueDialog).toBeHidden();

    // Visible truth: the campaign reports queued state and a queued
    // recipient ledger, and the queue-family actions are consumed. Two
    // count badges carry the queued ledger: recipient deliveries and their
    // pre-provider dispatch attempts.
    await expect(
      campaignCard.getByText("Queued", { exact: true }).first(),
    ).toBeVisible();
    await expect(campaignCard.getByText(/^\d+ Queued$/)).toHaveCount(2);
    await expect(
      campaignCard.getByRole("button", { name: "Finalize & queue" }),
    ).toHaveCount(0);

    // Durable truth: a frozen audience, one queued delivery and one queued
    // pre-provider attempt per included recipient, and no provider events.
    const { data: queued, error: queuedError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_communication_campaigns")
      .select(
        "id, status, audience_kind, content_finalized_at, audience_finalized_at, audience_size",
      )
      .eq("organization_id", fixture.organizationId)
      .eq("id", campaignId)
      .single();
    if (queuedError || !queued) {
      throw new Error(
        `Could not load the queued campaign: ${queuedError?.message ?? "missing campaign"}`,
      );
    }
    expect(queued).toMatchObject({
      id: campaignId,
      status: "queued",
      audience_kind: "term_members",
      content_finalized_at: expect.any(String),
      audience_finalized_at: expect.any(String),
    });
    if (typeof queued.audience_size !== "number" || queued.audience_size < 1) {
      throw new Error(
        "The queued campaign did not freeze a positive audience.",
      );
    }
    const audienceSize = queued.audience_size;

    const { data: snapshots, error: snapshotsError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_communication_recipient_snapshots")
      .select("id, campaign_id, subscription_decision")
      .eq("organization_id", fixture.organizationId)
      .eq("campaign_id", campaignId);
    expect(snapshotsError).toBeNull();
    const recipientSnapshots = snapshots ?? [];
    expect(recipientSnapshots).toHaveLength(audienceSize);
    expect(
      recipientSnapshots.every(
        (snapshot) =>
          snapshot.campaign_id === campaignId &&
          snapshot.subscription_decision === "included",
      ),
    ).toBe(true);

    const { data: queuedDeliveryRows, error: queuedDeliveriesError } =
      await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_deliveries")
        .select("id, recipient_snapshot_id, status, provider_message_id")
        .eq("organization_id", fixture.organizationId)
        .eq("campaign_id", campaignId);
    expect(queuedDeliveriesError).toBeNull();
    const queuedDeliveries = queuedDeliveryRows ?? [];
    expect(queuedDeliveries).toHaveLength(audienceSize);
    expect(
      new Set(
        queuedDeliveries.map((delivery) => delivery.recipient_snapshot_id),
      ),
    ).toEqual(new Set(recipientSnapshots.map((snapshot) => snapshot.id)));
    expect(
      queuedDeliveries.every(
        (delivery) =>
          delivery.status === "queued" && delivery.provider_message_id === null,
      ),
    ).toBe(true);

    const { data: queuedAttemptRows, error: queuedAttemptsError } =
      await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_dispatch_attempts")
        .select(
          "id, delivery_id, attempt_number, state, provider_message_id, dispatch_authorized_at, settled_at",
        )
        .eq("organization_id", fixture.organizationId)
        .eq("campaign_id", campaignId);
    expect(queuedAttemptsError).toBeNull();
    const queuedAttempts = queuedAttemptRows ?? [];
    expect(queuedAttempts).toHaveLength(audienceSize);
    expect(
      new Set(queuedAttempts.map((attempt) => attempt.delivery_id)),
    ).toEqual(new Set(queuedDeliveries.map((delivery) => delivery.id)));
    expect(
      queuedAttempts.every(
        (attempt) =>
          attempt.attempt_number === 1 &&
          attempt.state === "queued" &&
          attempt.provider_message_id === null &&
          attempt.dispatch_authorized_at === null &&
          attempt.settled_at === null,
      ),
    ).toBe(true);

    // Cancel through the same card with a recorded synthetic reason.
    await campaignCard
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    const cancelDialog = page.getByRole("dialog");
    await expect(
      cancelDialog.getByRole("heading", { name: "Cancel this campaign?" }),
    ).toBeVisible();
    await cancelDialog.getByLabel("Reason").fill(cancelReason);
    await cancelDialog
      .getByRole("button", { name: "Cancel campaign", exact: true })
      .click();
    await expect(cancelDialog).toBeHidden();

    await expect(
      campaignCard.getByText("Cancelled", { exact: true }).first(),
    ).toBeVisible();
    await expect(campaignCard.getByText(cancelReason)).toBeVisible();

    // Durable truth: the campaign is cancelled with its reason; every
    // attempt settled terminally on the cancellation path without provider
    // involvement; and no provider event ever matched this campaign.
    const { data: cancelled, error: cancelledError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_communication_campaigns")
      .select("status, cancellation_reason, cancelled_at")
      .eq("organization_id", fixture.organizationId)
      .eq("id", campaignId)
      .single();
    if (cancelledError || !cancelled) {
      throw new Error(
        `Could not load the cancelled campaign: ${cancelledError?.message ?? "missing campaign"}`,
      );
    }
    expect(cancelled).toEqual({
      status: "cancelled",
      cancellation_reason: cancelReason,
      cancelled_at: expect.any(String),
    });

    const { data: settledAttemptRows, error: settledAttemptsError } =
      await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_dispatch_attempts")
        .select(
          "id, state, failure_class, settlement_source, provider_message_id, dispatch_authorized_at, settled_at",
        )
        .eq("organization_id", fixture.organizationId)
        .eq("campaign_id", campaignId);
    expect(settledAttemptsError).toBeNull();
    const settledAttempts = settledAttemptRows ?? [];
    expect(settledAttempts).toHaveLength(audienceSize);
    expect(
      settledAttempts.every(
        (attempt) =>
          attempt.state === "failed" &&
          attempt.failure_class === "campaign_cancelled" &&
          attempt.settlement_source === "cancellation" &&
          attempt.provider_message_id === null &&
          attempt.dispatch_authorized_at === null &&
          typeof attempt.settled_at === "string",
      ),
    ).toBe(true);

    const { data: settledDeliveryRows, error: settledDeliveriesError } =
      await fixture.admin
        .schema("plugin_data")
        .from("csf_communication_deliveries")
        .select("status, provider_message_id")
        .eq("organization_id", fixture.organizationId)
        .eq("campaign_id", campaignId);
    expect(settledDeliveriesError).toBeNull();
    const settledDeliveries = settledDeliveryRows ?? [];
    expect(settledDeliveries).toHaveLength(audienceSize);
    expect(
      settledDeliveries.every(
        (delivery) =>
          delivery.status === "failed" && delivery.provider_message_id === null,
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
          settledAttempts.map((attempt) => attempt.id),
        );
    expect(providerEventsError).toBeNull();
    expect(providerEvents).toEqual([]);

    expectNoBrowserFailures(failures);
  });
});
