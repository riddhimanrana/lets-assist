import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

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
const officerHomePath = `${CSF_ORGANIZATION_PATH}?tab=csf-overview`;

async function verifiedTotal(page: Page) {
  const summary = page
    .getByRole("region", { name: "Point submissions", exact: true })
    .getByRole("progressbar", {
      name: "Submitted and approved service points",
    });
  await expect(summary).toBeVisible();
  const value = (await summary.getAttribute("aria-valuetext"))?.match(
    /, ([\d.]+) approved,/,
  )?.[1];
  if (!value)
    throw new Error("The verified point summary has no numeric total.");
  return Number(value.replaceAll(",", ""));
}

async function submissionFor(fixture: CsfFeedFixture, opportunityId: string) {
  const { data, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_point_submissions")
    .select(
      "id, profile_id, term_id, status, description, claimed_points, reviewed_by, revision",
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
  submissionDescription: string,
  termId: string,
  notes: string,
  decision: string,
) {
  await page.goto(officerHomePath, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /Review point submissions/ }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("tab") === "csf-submissions",
  );
  await expect(
    page.getByRole("combobox", { name: "Semester", exact: true }),
  ).toHaveValue(termId);
  await expect(
    page.getByRole("combobox", { name: "Class", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("review");
  const row = page.getByRole("row").filter({ hasText: submissionDescription });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Review", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: /^Review submission from .+$/,
  });
  const proof = dialog.getByRole("figure", {
    name: "proof-images.pdf",
    exact: true,
  });
  await expect(proof).toBeVisible();
  const original = proof.getByRole("button", {
    name: "Open original",
    exact: true,
  });
  await expect(original).toBeVisible();
  await expect(original).toHaveAttribute("href", /^https?:\/\//);
  await expect(proof.locator('object[type="application/pdf"]')).toHaveAttribute(
    "data",
    (await original.getAttribute("href"))!,
  );
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
  const initialDescription = activityTitle;
  const correctedDescription = `Corrected fictional activity name ${runId}`;
  const correctionNotes =
    "Correct the activity name shown in this fictional proof.";
  await seedFeedActivities(fixture, [
    {
      title: activityTitle,
      body: "Fictional activity for point correction acceptance.",
      startsAt: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
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
      .setInputFiles(
        ["first", "second"].map((name) => ({
          name: `${name}-fictional-service-proof.png`,
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
        })),
      );
    await dialog.getByRole("combobox", { name: /^Activity:/ }).click();
    await page
      .getByRole("option", { name: activityTitle, exact: true })
      .click();
    await expect(dialog.getByLabel("Description", { exact: true })).toHaveCount(
      0,
    );
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
      .select("id, bucket, object_path, original_filename, mime_type")
      .eq("organization_id", fixture.organizationId)
      .eq("submission_id", submitted.id);
    if (proofError)
      throw new Error(
        `Could not read the fictional proof: ${proofError.message}`,
      );
    expect(proofBefore).toHaveLength(1);
    expect(proofBefore![0].original_filename).toBe("proof-images.pdf");
    expect(proofBefore![0].mime_type).toBe("application/pdf");
    const { data: storedProof, error: storedProofError } =
      await fixture.admin.storage
        .from(proofBefore![0].bucket)
        .download(proofBefore![0].object_path);
    if (storedProofError || !storedProof)
      throw new Error("Could not read combined fictional proof.");
    expect(
      (await PDFDocument.load(await storedProof.arrayBuffer())).getPageCount(),
    ).toBe(2);

    await loginAs(officer, "admin", officerHomePath);
    await reviewSubmission(
      officer,
      initialDescription,
      fixture.currentTermId,
      correctionNotes,
      "Request changes",
    );
    await expect
      .poll(async () => (await submissionFor(fixture, activity.id))?.status)
      .toBe("needs_action");
    const changesRequested = (await submissionFor(fixture, activity.id))!;
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await verifiedTotal(page)).toBe(before);
    expect(await creditRows(fixture, submitted.id)).toEqual([]);
    const card = page
      .getByRole("article")
      .filter({ hasText: initialDescription });
    await expect(card).toContainText(correctionNotes);
    await expect(
      card.getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Details", exact: true }).click();
    const details = page.getByRole("dialog", {
      name: "Submission details",
      exact: true,
    });
    await expect(
      details.getByRole("figure", { name: "proof-images.pdf", exact: true }),
    ).toBeVisible();
    await expect(details).toContainText(correctionNotes);
    await details.getByRole("button", { name: "Edit", exact: true }).click();
    const correction = page.getByRole("dialog", {
      name: "Edit submission",
      exact: true,
    });
    await expect(correction).toContainText(
      "Your current proof stays attached until this edit saves.",
    );
    await correction
      .getByLabel("What you did", { exact: true })
      .fill(correctedDescription);
    await correction
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(correction).toBeHidden();
    await expect
      .poll(async () => (await submissionFor(fixture, activity.id))?.status)
      .toBe("submitted");
    expect((await submissionFor(fixture, activity.id))?.description).toBe(
      correctedDescription,
    );
    expect((await submissionFor(fixture, activity.id))?.id).toBe(submitted.id);
    expect((await submissionFor(fixture, activity.id))?.revision).toBe(
      changesRequested.revision + 1,
    );
    expect(await verifiedTotal(page)).toBe(before);
    expect(await creditRows(fixture, submitted.id)).toEqual([]);

    await reviewSubmission(
      officer,
      correctedDescription,
      fixture.currentTermId,
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
            requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
            previousRevision: changesRequested.revision,
            revision: changesRequested.revision + 1,
          }),
        }),
        expect.objectContaining({
          action: "approved",
          next_status: "approved",
        }),
      ]),
    );
    const { data: revisions, error: revisionError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_admin_audit_events")
      .select("before_data, after_data, correlation_id")
      .eq("organization_id", fixture.organizationId)
      .eq("target_id", submitted.id)
      .eq("action", "point_submission.revised");
    if (revisionError)
      throw new Error(
        `Could not read the fictional revision audit: ${revisionError.message}`,
      );
    expect(revisions).toHaveLength(1);
    expect(revisions![0]).toMatchObject({
      before_data: {
        description: initialDescription,
        revision: changesRequested.revision,
      },
      after_data: {
        intent: { description: correctedDescription },
        replacementFileId: null,
        result: {
          submissionId: submitted.id,
          revision: changesRequested.revision + 1,
        },
      },
      correlation_id: reviews?.find((review) => review.action === "resubmitted")
        ?.details.requestId,
    });
    const { data: proofAfter, error: retainedProofError } = await fixture.admin
      .schema("plugin_data")
      .from("csf_submission_files")
      .select("id, bucket, object_path, original_filename, mime_type")
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
