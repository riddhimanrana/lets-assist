import { expect, test, type Page } from "@playwright/test";
import {
  EXPLAINED_REASON,
  loadSheetDecisionFixture,
  publishedState,
  releaseDecisions,
  resetSheetDecisionFixture,
  restoreAppReview,
  stageDecisions,
  termState,
  type SheetApplicants,
  type SheetDecisionFixture,
} from "./sheet-decision-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  expectNoHorizontalOverflow,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

let fixture: SheetDecisionFixture;
let applicants: SheetApplicants;
const panel = (page: Page) =>
  page.getByRole("region", { name: /^Sheet review for / });
const row = (page: Page, lastName: string) =>
  page.getByRole("listitem").filter({ hasText: lastName });
async function openApplications(page: Page) {
  await page.goto(
    `${CSF_ORGANIZATION_PATH}?tab=csf-applications&csf_review_term=${fixture.termId}&csf_review_cohort=${fixture.cohortId}`,
  );
  await expect(panel(page)).toBeVisible();
  const release = panel(page).getByRole("button", { name: "Review release" });
  if (await release.count()) await expect(release).toBeEnabled();
}
async function stageOutcomes() {
  await stageDecisions(fixture, [
    {
      applicant: applicants.byRole.accepted,
      status: "accepted",
      observedColor: "#d9ead3",
    },
    {
      applicant: applicants.byRole.rejected,
      status: "rejected",
      observedColor: "#f4cccc",
      reason: EXPLAINED_REASON,
    },
    {
      applicant: applicants.byRole.explained,
      status: "on_hold",
      observedColor: "#fff2cc",
      reason: EXPLAINED_REASON,
    },
    {
      applicant: applicants.byRole.blocked,
      status: "on_hold",
      observedColor: "#fff2cc",
    },
    {
      applicant: applicants.byRole.unreviewed,
      status: "unreviewed",
      observedColor: null,
    },
  ]);
}
async function approveRelease(page: Page) {
  await panel(page).getByRole("button", { name: "Review release" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Publish decisions" }).click();
  await expect(dialog).not.toBeVisible();
}
test.beforeAll(async () => {
  fixture = await loadSheetDecisionFixture();
});
test.afterAll(async () => {
  await restoreAppReview(fixture);
});
// eslint-disable-next-line no-empty-pattern
test.beforeEach(async ({}, info) => {
  applicants = await resetSheetDecisionFixture(fixture, info.title);
});

for (const width of [1280, 390]) {
  test(`officer reviews holds and approves a release at ${width}px`, async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageOutcomes();
    await page.setViewportSize({ width, height: 900 });
    await loginAs(page, "adviser");
    await openApplications(page);
    await expect(panel(page)).toContainText("Google Sheets");
    await expect(row(page, applicants.byRole.explained.lastName)).toContainText(
      "Awaiting another officer",
    );
    await expect(
      page.getByRole("button", { name: "Split for review" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Review my queue" }),
    ).toHaveCount(0);
    const filter = page.getByRole("combobox", { name: "Sheet decision" });
    for (const [label, role] of [
      ["Accepted", "accepted"],
      ["Rejected", "rejected"],
      ["Awaiting review", "explained"],
      ["Unreviewed", "unreviewed"],
    ] as const) {
      await filter.click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await expect(row(page, applicants.byRole[role].lastName)).toBeVisible();
    }
    await openApplications(page);
    await panel(page).getByRole("button", { name: "Review release" }).click();
    expect(
      (await publishedState(fixture, applicants.byRole.accepted))
        .applicationStatus,
    ).toBe("submitted");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Keep reviewing" })
      .click();
    await approveRelease(page);
    await expect
      .poll(
        async () =>
          (await publishedState(fixture, applicants.byRole.accepted))
            .membershipStatus,
      )
      .toBe("accepted");
    expect(
      (await publishedState(fixture, applicants.byRole.rejected))
        .applicationStatus,
    ).toBe("rejected");
    for (const role of ["explained", "blocked", "unreviewed"] as const)
      expect(
        (await publishedState(fixture, applicants.byRole[role]))
          .applicationStatus,
      ).toBe("submitted");
    await page.getByRole("button", { name: /^Pending \(/ }).click();
    await expect(row(page, applicants.byRole.accepted.lastName)).toHaveCount(0);
    await expect(row(page, applicants.byRole.rejected.lastName)).toHaveCount(0);
    await expect(row(page, applicants.byRole.explained.lastName)).toBeVisible();
    await page.getByRole("button", { name: /^All \(/ }).click();
    await expect(row(page, applicants.byRole.accepted.lastName)).toContainText(
      "Approved",
    );
    await expect(row(page, applicants.byRole.rejected.lastName)).toContainText(
      "Rejected",
    );
    await expectNoHorizontalOverflow(page);
    expectNoBrowserFailures(failures);
  });
}
test("a changed snapshot refuses an open approval dialog", async ({ page }) => {
  await stageOutcomes();
  await loginAs(page, "adviser");
  await openApplications(page);
  await panel(page).getByRole("button", { name: "Review release" }).click();
  await stageDecisions(fixture, [
    {
      applicant: applicants.byRole.accepted,
      status: "rejected",
      observedColor: "#f4cccc",
    },
  ]);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Publish decisions" })
    .click();
  await expect(
    page.getByText("Decisions changed. Review the release again.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
  expect(
    (await publishedState(fixture, applicants.byRole.accepted))
      .applicationStatus,
  ).toBe("submitted");
});
test("sync preserves released access until another officer release", async () => {
  await stageOutcomes();
  await releaseDecisions(fixture);
  await stageDecisions(fixture, [
    {
      applicant: applicants.byRole.accepted,
      status: "rejected",
      observedColor: "#f4cccc",
    },
  ]);
  expect(
    (await publishedState(fixture, applicants.byRole.accepted))
      .membershipStatus,
  ).toBe("accepted");
  await releaseDecisions(fixture);
  expect(
    (await publishedState(fixture, applicants.byRole.accepted))
      .membershipStatus,
  ).toBe("revoked");
});
test("clearing a fill never retracts a published decision", async () => {
  await stageOutcomes();
  await releaseDecisions(fixture);
  await stageDecisions(fixture, [
    {
      applicant: applicants.byRole.accepted,
      status: "unreviewed",
      observedColor: null,
    },
  ]);
  await releaseDecisions(fixture);
  expect(
    (await publishedState(fixture, applicants.byRole.accepted))
      .membershipStatus,
  ).toBe("accepted");
});
test("a failed provider check cannot change published decisions", async ({
  page,
}) => {
  await stageOutcomes();
  const before = await termState(fixture);
  await loginAs(page, "adviser");
  await openApplications(page);
  await panel(page).getByRole("button", { name: "Sync now" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
  expect((await termState(fixture)).releaseCount).toBe(before.releaseCount);
});
test("a reader cannot release or configure decisions", async ({ page }) => {
  await stageOutcomes();
  await loginAs(page, "dataManagement");
  await openApplications(page);
  await expect(
    panel(page).getByRole("button", { name: "Review release" }),
  ).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: "Mapping" }),
  ).toHaveCount(0);
});
