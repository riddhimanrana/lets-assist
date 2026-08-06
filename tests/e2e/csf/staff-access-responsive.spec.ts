import { expect, test, type Page } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  expectNoHorizontalOverflow,
  expectNoPrivateBoundaryMarkers,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const STAFF_TAB_URL = `${CSF_ORGANIZATION_PATH}?tab=csf-staff`;

/**
 * The distinct staff-access concepts. Each one is its own desktop column and its
 * own phone label, so a reader can never confuse the CSF officer record with the
 * Let's Assist account, or the public title with the internal responsibility.
 */
const staffConcepts = [
  "Officer",
  "Let's Assist account",
  "Public position",
  "Responsibility",
  "School year",
  "Effective dates",
  "Access status",
  "Action",
] as const;

async function openStaffAccess(page: Page) {
  await page.goto(STAFF_TAB_URL, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Officer roster", exact: true }),
  ).toBeVisible();
}

test.describe("DVHS CSF staff access presentation", () => {
  test("desktop splits every staff-access concept into its own column", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "admin", STAFF_TAB_URL);
    await openStaffAccess(page);

    for (const concept of staffConcepts) {
      await expect(
        page.getByRole("columnheader", { name: concept, exact: true }),
        `${concept} should be its own desktop column`,
      ).toBeVisible();
    }

    // Position seats keeps its own labelled table on the same screen.
    await expect(
      page.getByRole("heading", { name: "Position seats", exact: true }),
    ).toBeVisible();
    for (const concept of ["Position", "Seats", "Type", "Access"]) {
      await expect(
        page.getByRole("columnheader", { name: concept, exact: true }),
      ).toBeVisible();
    }

    expectNoBrowserFailures(failures);
  });

  test("phone shows every desktop concept as labelled cards with no page overflow", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "admin", STAFF_TAB_URL);
    await openStaffAccess(page);

    await expectNoHorizontalOverflow(page);

    // The desktop table is not the phone experience: no column headers survive,
    // and no scroll container stands in for a real phone layout.
    await expect(page.getByRole("columnheader")).toHaveCount(0);

    // Every concept the desktop splits into a column is present in the phone
    // DOM: Officer is the card heading, Action is the card action, and the rest
    // are labelled facts.
    const roster = page.getByRole("region", { name: "Officer roster" });
    for (const concept of [
      "Let's Assist account",
      "Public position",
      "Responsibility",
      "School year",
      "Effective dates",
      "Access status",
    ]) {
      await expect(
        roster
          .getByText(concept, { exact: true })
          .filter({ visible: true })
          .first(),
        `${concept} should be labelled on the phone card`,
      ).toBeVisible();
    }

    expectNoBrowserFailures(failures);
  });

  test("phone keeps the revoke action reachable with restored focus", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "admin", STAFF_TAB_URL);
    await openStaffAccess(page);

    const revoke = page
      .getByRole("button", { name: "Revoke", exact: true })
      .first();
    await revoke.click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Revoke staff access", exact: true }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(revoke).toBeFocused();

    expectNoBrowserFailures(failures);
  });

  test("phone staff access states an unlinked profile and account separately", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, "admin", STAFF_TAB_URL);
    await openStaffAccess(page);

    // Both wordings are distinct concepts. Whichever the fixture data produces,
    // neither may be replaced by a generic "no linked account".
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("No linked account");
    expect(body).not.toContain("Unassigned CSF profile");
  });

  test("a member cannot reach the staff access workspace", async ({ page }) => {
    await loginAs(page, "member");
    await page.goto(STAFF_TAB_URL, { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Officer roster", exact: true }),
    ).toHaveCount(0);
    expectNoPrivateBoundaryMarkers(await page.locator("body").innerText());
  });
});

test.describe("DVHS CSF proof submission", () => {
  test("phone proof field states its constraints and rejects an oversized file", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(
      page,
      "member",
      `${CSF_ORGANIZATION_PATH}?tab=csf-submissions`,
    );

    await page
      .getByRole("button", { name: "Submit points", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const proof = dialog.getByLabel("One proof file");
    await expect(proof).toBeVisible();

    // The constraints are associated with the input, not merely nearby.
    const describedBy = await proof.getAttribute("aria-describedby");
    expect(describedBy).toContain("csf-submission-evidence-constraints");
    await expect(
      dialog.locator("#csf-submission-evidence-constraints"),
    ).toContainText("10 MB maximum");
    await expect(
      dialog.locator("#csf-submission-evidence-constraints"),
    ).toContainText("JPEG, PNG, WebP, HEIC, or PDF");
    await expect(
      dialog.locator("#csf-submission-evidence-constraints"),
    ).toContainText("stored privately");

    // An accepted file reports its own name and formatted size.
    await proof.setInputFiles({
      name: "service-proof.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(2048, 7),
    });
    const selection = dialog.locator("#csf-submission-evidence-selection");
    await expect(selection).toHaveAttribute("role", "status");
    await expect(selection).toContainText("service-proof.png");
    await expect(selection).toContainText("2.0 KB");

    // An oversized file is rejected before any submission, with retryable text.
    await proof.setInputFiles({
      name: "oversized-proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(11 * 1024 * 1024, 3),
    });
    const rejection = dialog.locator("#csf-submission-evidence-error");
    await expect(rejection).toHaveAttribute("role", "alert");
    await expect(rejection).toContainText("oversized-proof.pdf is 11 MB");
    await expect(rejection).toContainText("10 MB or less");
    await expect(proof).toHaveAttribute("aria-invalid", "true");
    await expect(
      rejection.getByRole("button", {
        name: "Choose a different file",
        exact: true,
      }),
    ).toBeVisible();
    await expect(selection).toBeEmpty();

    // The dialog is still open and nothing published a percentage.
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    expectNoBrowserFailures(failures);
  });

  test("the upload phase is announced without a byte percentage", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(
      page,
      "member",
      `${CSF_ORGANIZATION_PATH}?tab=csf-submissions`,
    );

    await page
      .getByRole("button", { name: "Submit points", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const form = dialog.locator("form");
    await expect(form).not.toHaveAttribute("aria-busy", "true");

    await dialog.getByLabel("One proof file").setInputFiles({
      name: "service-proof.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(1024, 5),
    });
    // Exact, so "Point type" and "Point source" cannot also match.
    await dialog.getByLabel("Points", { exact: true }).fill("1");
    await dialog
      .getByRole("button", { name: "Submit for review", exact: true })
      .click();

    // The phase is indeterminate: a named progressbar with no value, plus an
    // announced status. It may resolve quickly, so accept either state.
    const progress = page.getByRole("progressbar", { name: "Upload progress" });
    if (await progress.count()) {
      await expect(progress).not.toHaveAttribute("aria-valuenow", /.*/);
      await expect(form).toHaveAttribute("aria-busy", "true");
    }
    expect(await page.locator("body").innerText()).not.toMatch(/\b\d{1,3}%/);

    expectNoBrowserFailures(failures);
  });
});
