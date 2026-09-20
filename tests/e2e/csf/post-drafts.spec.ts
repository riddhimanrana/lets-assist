import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  cleanFeedActivities,
  cleanFeedPosts,
  loadCsfFeedFixture,
  seedFeedActivities,
} from "./feed-fixtures";
import { CSF_ORGANIZATION_PATH, loginAs } from "./helpers";

test("saving a formatted draft suppresses the checked email option", async ({
  page,
}) => {
  const fixture = await loadCsfFeedFixture();
  const prefix = `E2E draft suppression ${randomUUID()}`;
  const title = `${prefix} announcement`;
  await loginAs(page, "admin");
  await page.goto(
    `${CSF_ORGANIZATION_PATH}?tab=csf-cohorts&csf_cohort=${fixture.cohortIdsByYear[2028]}&csf_cohort_tab=stream`,
  );
  await page
    .getByRole("region", { name: "Class stream" })
    .getByRole("button", { name: "Announce something to Class of 2028" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  const message = dialog.getByLabel("Message");
  const formatting = dialog.getByRole("group", { name: "Text formatting" });
  await message.click();
  await formatting.getByRole("button", { name: "Bold", exact: true }).click();
  await page.keyboard.type("Fictional formatted announcement");
  await expect(message.locator("strong")).toHaveText(
    "Fictional formatted announcement",
  );
  await expect(
    formatting.getByRole("button", { name: "Bold", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Italic", "Underline", "Insert link"]) {
    await expect(
      formatting.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(
    dialog.getByRole("checkbox", { name: "Also send this as an email" }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "Save as draft", exact: true })
    .click();
  await expect
    .poll(async () => {
      const { data, error } = await fixture.admin
        .schema("plugin_data")
        .from("csf_announcements")
        .select("id, status, body, email_requested, email_campaign_id")
        .eq("organization_id", fixture.organizationId)
        .eq("title", title)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    })
    .toEqual({
      id: expect.any(String),
      status: "draft",
      body: expect.stringContaining(
        "<strong>Fictional formatted announcement</strong>",
      ),
      email_requested: false,
      email_campaign_id: null,
    });
  await expect(dialog).not.toBeVisible();
  const { data: draft, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_announcements")
    .select("id")
    .eq("organization_id", fixture.organizationId)
    .eq("title", title)
    .single();
  if (error || !draft) throw new Error(error?.message ?? "Draft missing.");
  await cleanFeedPosts(fixture, prefix, {
    expectedPosts: [{ id: draft.id, emailCampaignId: null }],
  });
});

test("officer stream shows its published activities with scoped direct links", async ({
  page,
}) => {
  const fixture = await loadCsfFeedFixture();
  const prefix = `E2E stream activity ${randomUUID()}`;
  const startsAt = new Date(Date.now() + 86_400_000).toISOString();
  const otherCohort = Object.entries(fixture.cohortIdsByYear).find(
    ([year]) => year !== "2028",
  )![1];
  await seedFeedActivities(fixture, [
    {
      title: `${prefix} own class`,
      body: "Fictional class activity",
      startsAt,
      cohortId: fixture.cohortIdsByYear[2028],
      termId: fixture.currentTermId,
    },
    {
      title: `${prefix} other class`,
      body: "Fictional other activity",
      startsAt,
      cohortId: otherCohort,
      termId: fixture.currentTermId,
    },
  ]);
  try {
    const { data: activity, error } = await fixture.admin
      .schema("plugin_data")
      .from("csf_opportunities")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("title", `${prefix} own class`)
      .single();
    if (error || !activity)
      throw new Error(error?.message ?? "Activity missing.");
    await loginAs(page, "admin");
    await page.goto(
      `${CSF_ORGANIZATION_PATH}?tab=csf-cohorts&csf_cohort=${fixture.cohortIdsByYear[2028]}&csf_cohort_tab=stream`,
    );
    const stream = page.getByRole("region", { name: "Class stream" });
    const card = stream.locator(`article[data-activity-id="${activity.id}"]`);
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("button", { name: "View activity" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`csf_activity=${activity.id}`),
    );
    await expect(
      stream.getByText(`${prefix} other class`, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await cleanFeedActivities(fixture, prefix);
  }
});

test("officers can delete an unused activity through the audited action", async ({
  page,
}) => {
  const fixture = await loadCsfFeedFixture();
  const title = `E2E unused activity ${randomUUID()}`;
  await seedFeedActivities(fixture, [
    {
      title,
      body: "Fictional unused activity",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      cohortId: fixture.cohortIdsByYear[2028],
      termId: fixture.currentTermId,
    },
  ]);
  try {
    const { data: activity, error } = await fixture.admin
      .schema("plugin_data")
      .from("csf_opportunities")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("title", title)
      .single();
    if (error || !activity)
      throw new Error(error?.message ?? "Activity missing.");
    await loginAs(page, "admin");
    await page.goto(
      `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_activity=${activity.id}`,
    );
    await page
      .getByRole("button", { name: `Actions for ${title}`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Delete activity", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: `Delete ${title}?`,
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Delete activity", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const remaining = await fixture.admin
      .schema("plugin_data")
      .from("csf_opportunities")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("id", activity.id);
    expect(remaining.error).toBeNull();
    expect(remaining.data).toEqual([]);
    const receipts = await fixture.admin
      .schema("plugin_data")
      .from("csf_admin_audit_events")
      .select("id")
      .eq("organization_id", fixture.organizationId)
      .eq("target_id", activity.id)
      .eq("action", "activity.deleted");
    expect(receipts.error).toBeNull();
    expect(receipts.data).toHaveLength(1);
  } finally {
    await cleanFeedActivities(fixture, title);
  }
});
