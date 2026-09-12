import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  loadCsfFeedFixture,
  seedFeedActivities,
  type CsfFeedFixture,
} from "./feed-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const memberPath = `${CSF_ORGANIZATION_PATH}?tab=csf-submissions`;
const officerPath = `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_service=points`;

async function verifiedTotal(page: Page) {
  const summary = page
    .getByRole("region", { name: "Point submissions", exact: true })
    .getByText(/points verified this semester/);
  await expect(summary).toBeVisible();
  const value = (await summary.innerText()).match(/^([\d,.]+)/)?.[1];
  if (!value)
    throw new Error("The verified point summary has no numeric total.");
  return Number(value.replaceAll(",", ""));
}

async function submissionFor(fixture: CsfFeedFixture, opportunityId: string) {
  const { data, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_point_submissions")
    .select(
      "id, profile_id, term_id, status, description, claimed_points, reviewed_by",
    )
    .eq("organization_id", fixture.organizationId)
    .eq("opportunity_id", opportunityId)
    .limit(2);
  if (error)
    throw new Error(
      `Could not read the fictional submission: ${error.message}`,
    );
  expect(data?.length ?? 0).toBeLessThanOrEqual(1);
  return data?.[0] ?? null;
}

async function creditRows(fixture: CsfFeedFixture, submissionId: string) {
  const { data, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_credit_records")
    .select("id, profile_id, term_id, points, point_type, status")
    .eq("organization_id", fixture.organizationId)
    .eq("submission_id", submissionId);
  if (error)
    throw new Error(`Could not read fictional credits: ${error.message}`);
  return data ?? [];
}

async function reviewSubmission(
  page: Page,
  activityTitle: string,
  notes: string,
  decision: string,
) {
  await page.goto(officerPath, { waitUntil: "domcontentloaded" });
  const row = page.getByRole("row").filter({ hasText: activityTitle });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Review", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Review .+'s activity$/ });
  await dialog.getByLabel("Review notes").fill(notes);
  await dialog.getByRole("button", { name: decision, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("point proof correction earns one verified credit only after officer approval", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  // The fixture loader refuses remote or mismatched databases using the live
  // isolated-stack marker. Every new row belongs to this random activity.
  const fixture = await loadCsfFeedFixture();
  const runId = randomUUID();
  const activityTitle = `Synthetic point lifecycle ${runId}`;
  const initialDescription = `Fictional service proof ${runId}`;
  const correctedDescription = `Fictional service proof with task details ${runId}`;
  const correctionNotes =
    "Describe the service task shown in this fictional proof.";
  await seedFeedActivities(fixture, [
    {
      title: activityTitle,
      body: "Fictional activity for point correction acceptance.",
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
      termId: fixture.currentTermId,
      pointValue: 1,
      pointType: "non_drive",
    },
  ]);
  const { data: activity, error: activityError } = await fixture.admin
    .schema("plugin_data")
    .from("csf_opportunities")
    .select("id")
    .eq("organization_id", fixture.organizationId)
    .eq("title", activityTitle)
    .single();
  if (activityError || !activity)
    throw new Error("Could not find the owned fictional activity.");
  const { error: claimableError } = await fixture.admin
    .schema("plugin_data")
    .from("csf_opportunities")
    .update({ requires_point_submission: true })
    .eq("organization_id", fixture.organizationId)
    .eq("id", activity.id)
    .eq("title", activityTitle);
  if (claimableError)
    throw new Error(
      `Could not enable fictional member claims: ${claimableError.message}`,
    );

  const officerContext = await browser.newContext();
  const officer = await officerContext.newPage();
  const memberFailures = watchBrowserFailures(page);
  const officerFailures = watchBrowserFailures(officer);
  try {
    await loginAs(page, "member", memberPath);
    const before = await verifiedTotal(page);
    await page
      .getByRole("button", { name: "Submit points", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Submit points",
      exact: true,
    });
    await expect(
      dialog.getByRole("combobox", { name: /^Semester(?::|$)/i }),
    ).toHaveCount(0);
    await expect(dialog.locator('input[name="termId"]')).toHaveValue(
      fixture.currentTermId,
    );
    await dialog
      .getByRole("button", { name: "Proof file", exact: true })
      .setInputFiles({
        name: "fictional-service-proof.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await dialog.getByRole("combobox", { name: /^Activity:/ }).click();
    await page
      .getByRole("option", { name: activityTitle, exact: true })
      .click();
    await dialog.getByLabel("Description").fill(initialDescription);
    await dialog
      .getByRole("button", { name: "Submit for review", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => (await submissionFor(fixture, activity.id))?.status)
      .toBe("submitted");
    const submitted = (await submissionFor(fixture, activity.id))!;
    expect(submitted.term_id).toBe(fixture.currentTermId);
    expect(await verifiedTotal(page)).toBe(before);
    expect(await creditRows(fixture, submitted.id)).toEqual([]);
    const { data: proofBefore, error: proofError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_submission_files")
      .select("id, object_path, original_filename")
      .eq("organization_id", fixture.organizationId)
      .eq("submission_id", submitted.id);
    if (proofError)
      throw new Error(
        `Could not read the fictional proof: ${proofError.message}`,
      );
    expect(proofBefore).toHaveLength(1);
    expect(proofBefore![0].original_filename).toBe(
      "fictional-service-proof.png",
    );

    await loginAs(officer, "admin", officerPath);
    await reviewSubmission(
      officer,
      activityTitle,
      correctionNotes,
      "Request changes",
    );
    await expect
      .poll(async () => (await submissionFor(fixture, activity.id))?.status)
      .toBe("needs_action");
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await verifiedTotal(page)).toBe(before);
    expect(await creditRows(fixture, submitted.id)).toEqual([]);
    const card = page
      .getByRole("article")
      .filter({ hasText: initialDescription });
    await expect(card).toContainText(correctionNotes);
    await card
      .getByRole("button", { name: "Update and resubmit", exact: true })
      .click();
    const correction = page.getByRole("dialog", {
      name: "Correct and resubmit",
      exact: true,
    });
    await expect(correction).toContainText("Existing proof stays attached");
    await correction.getByLabel("Description").fill(correctedDescription);
    await correction
      .getByRole("button", { name: "Correct and resubmit", exact: true })
      .click();
    await expect(correction).toBeHidden();
    await expect
      .poll(async () => (await submissionFor(fixture, activity.id))?.status)
      .toBe("submitted");
    expect((await submissionFor(fixture, activity.id))?.description).toBe(
      correctedDescription,
    );
    expect(await verifiedTotal(page)).toBe(before);
    expect(await creditRows(fixture, submitted.id)).toEqual([]);

    await reviewSubmission(
      officer,
      activityTitle,
      "Fictional proof and corrected task details verified.",
      "Approve award",
    );
    await expect
      .poll(async () => (await submissionFor(fixture, activity.id))?.status)
      .toBe("approved");
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await verifiedTotal(page)).toBe(before + 1);
    const approvedCard = page
      .getByRole("article")
      .filter({ hasText: correctedDescription });
    await expect(
      approvedCard.getByText("Verified", { exact: true }),
    ).toBeVisible();
    const credits = await creditRows(fixture, submitted.id);
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({
      profile_id: submitted.profile_id,
      term_id: fixture.currentTermId,
      points: 1,
      point_type: "non_drive",
      status: "verified",
    });
    const { data: reviews, error: reviewsError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_submission_reviews")
      .select("action, previous_status, next_status, notes, details")
      .eq("organization_id", fixture.organizationId)
      .eq("submission_id", submitted.id)
      .order("created_at");
    if (reviewsError)
      throw new Error(
        `Could not read fictional review history: ${reviewsError.message}`,
      );
    expect(reviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "needs_action",
          next_status: "needs_action",
          notes: correctionNotes,
        }),
        expect.objectContaining({
          action: "resubmitted",
          previous_status: "needs_action",
          next_status: "submitted",
          details: expect.objectContaining({
            proofRetained: true,
            previousDescription: initialDescription,
            description: correctedDescription,
          }),
        }),
        expect.objectContaining({
          action: "approved",
          next_status: "approved",
        }),
      ]),
    );
    const { data: proofAfter, error: retainedProofError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_submission_files")
      .select("id, object_path, original_filename")
      .eq("organization_id", fixture.organizationId)
      .eq("submission_id", submitted.id);
    if (retainedProofError)
      throw new Error(
        `Could not verify retained proof: ${retainedProofError.message}`,
      );
    expect(proofAfter).toEqual(proofBefore);
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await verifiedTotal(page)).toBe(before + 1);
    expect(await creditRows(fixture, submitted.id)).toEqual(credits);
    expectNoBrowserFailures(memberFailures);
    expectNoBrowserFailures(officerFailures);
  } finally {
    await officerContext.close();
    // Keep the owned submission, proof, credit, and immutable review history as
    // isolated-run evidence. Retire its activity so later tests cannot claim it.
    const { error } = await fixture.admin
      .schema("plugin_data")
      .from("csf_opportunities")
      .update({ status: "archived" })
      .eq("organization_id", fixture.organizationId)
      .eq("id", activity.id)
      .eq("title", activityTitle);
    expect(
      error,
      "The owned fictional activity should retire successfully",
    ).toBeNull();
  }
});
