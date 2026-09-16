import { expect, test, type Page } from "@playwright/test";

import {
  EXPLAINED_REASON,
  SHEET_FIXTURE_PREFIX,
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
  loginAs,
  watchBrowserFailures,
} from "./helpers";

/**
 * Sheets application review, from a staged decision nobody has published to a
 * released one that a later sync takes back.
 *
 * The rule the whole feature turns on is that a decision read out of the
 * workbook is private until an officer releases the semester. A staged
 * acceptance grants nothing and a staged rejection tells nobody. Release is the
 * single moment either becomes true, and a later sync corrects an
 * already-released row straight away, including taking membership back.
 *
 * Officers are allowed to read staged decisions and the reasons they wrote:
 * that is the review surface. The applicant-facing half of the rule is
 * `sheet-decision-applicant.spec.ts`, which signs in as each applicant.
 *
 * Nothing here touches Google. Rows are staged through
 * `csf_stage_sheet_application_decisions` with synthetic evidence, which is the
 * same RPC the Sync action calls once it has read a workbook. The Sync button
 * is still exercised, because an isolated stack has no Drive token and the
 * honest behaviour there is a stated source failure rather than a quiet success.
 */

const APPLICATIONS_PATH = `${CSF_ORGANIZATION_PATH}?tab=csf-applications`;
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

let fixture: SheetDecisionFixture;
/**
 * Allocated per test. Staged decisions are keyed on their application and
 * cannot be deleted by a fixture, so reusing application ids would inherit the
 * previous test's released state and its roster rows.
 */
let applicants: SheetApplicants;

function panel(page: Page) {
  return page.getByRole("region", { name: /^Sheet review for / });
}

function rosterRow(page: Page, lastName: string) {
  return page.getByRole("listitem").filter({ hasText: lastName });
}

async function openApplications(page: Page) {
  await page.goto(
    `${APPLICATIONS_PATH}&csf_review_term=${fixture.termId}&csf_review_cohort=${fixture.cohortId}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(panel(page)).toBeVisible();
}

/** Stage the five outcomes the roster has to tell apart. */
async function stageTheFiveOutcomes() {
  return stageDecisions(fixture, [
    {
      applicant: applicants.byRole.accepted,
      status: "accepted",
      observedColor: "#d9ead3",
    },
    {
      applicant: applicants.byRole.rejected,
      status: "rejected",
      observedColor: "#f4cccc",
    },
    {
      applicant: applicants.byRole.explained,
      status: "rejected_with_explanation",
      observedColor: "#fff2cc",
      reason: EXPLAINED_REASON,
    },
    {
      applicant: applicants.byRole.unreviewed,
      status: "unreviewed",
      observedColor: null,
    },
    {
      // Yellow with no reason. The chapter's rule is that this row cannot be
      // released until somebody writes the explanation in the workbook.
      applicant: applicants.byRole.blocked,
      status: "rejected_with_explanation",
      observedColor: "#fff2cc",
      reason: null,
    },
  ]);
}

test.beforeAll(async () => {
  fixture = await loadSheetDecisionFixture();
});

test.afterAll(async () => {
  // Hand the semester back to in-app review so the specs after this one see the
  // seeded state they expect.
  await restoreAppReview(fixture);
});

// Playwright reads the hook's fixture list off the first parameter and rejects
// anything that is not a destructuring pattern, so a named placeholder fails at
// discovery time. The empty pattern is the documented way to take `testInfo`
// while requesting no fixtures; `no-empty-pattern` is off for this line only.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(async ({}, testInfo) => {
  applicants = await resetSheetDecisionFixture(fixture, testInfo.title);
});

test.describe("staged decisions before any release", () => {
  test("the panel says nothing is published and the roster agrees", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "adviser");
    await openApplications(page);

    await expect(panel(page)).toContainText(
      "Applications are reviewed in the Sheet",
    );
    // The panel's publication line is gated on the term's `releaseCount`, which
    // is monotonic and shared by every scenario in this semester. Pinning the
    // "nothing published yet" wording would therefore hold only until some
    // earlier test released. Assert that the line is present in whichever of
    // its two forms is true; the per-applicant rows below carry what this test
    // actually means.
    await expect(panel(page)).toContainText(
      /Decisions read from the workbook stay private until you release them\.|Released \d+ time/,
    );

    // Every staged verdict names itself and says it is not published.
    await expect(
      rosterRow(page, applicants.byRole.accepted.lastName),
    ).toContainText("Accepted in the Sheet · not published yet");
    await expect(
      rosterRow(page, applicants.byRole.rejected.lastName),
    ).toContainText("Rejected in the Sheet · not published yet");
    await expect(
      rosterRow(page, applicants.byRole.explained.lastName),
    ).toContainText("Rejected with a reason · not published yet");
    // An uncoloured row is not a rejection and must never read as one.
    const unreviewed = rosterRow(page, applicants.byRole.unreviewed.lastName);
    await expect(unreviewed).toContainText("Not reviewed in the Sheet");
    await expect(unreviewed).not.toContainText("Rejected");
    await expect(unreviewed).not.toContainText("published");

    // The yellow row with no reason states the officer's next action.
    await expect(
      rosterRow(page, applicants.byRole.blocked.lastName),
    ).toContainText("Add the reason in the Sheet before releasing");

    expectNoBrowserFailures(failures);
  });

  test("staging grants no membership and decides no application", async () => {
    await stageTheFiveOutcomes();

    for (const applicant of applicants.all) {
      const state = await publishedState(fixture, applicant);
      expect(state.applicationStatus).toBe("submitted");
      expect(state.membershipStatus).toBeNull();
    }

    // `releaseCount` and `counts.released` are term-wide and monotonic: the
    // release RPC advances them and nothing resets them, so an absolute zero
    // would only hold until some other test in this semester released. What
    // this test means is that *these* applicants are unpublished, which the
    // per-applicant loop above already proves. The term-level claim that still
    // holds is that the unexplained yellow row is blocked rather than
    // releasable.
    const state = await termState(fixture);
    expect(state.counts.blocked).toBeGreaterThanOrEqual(1);
  });

  test("an unrelated member sees none of this chapter's staged review", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "member");

    // A bystander check, not the privacy acceptance. What each applicant can
    // and cannot read of their OWN decision is
    // `sheet-decision-applicant.spec.ts`, signed in as that applicant.
    //
    // Note what is deliberately absent here: nothing asserts that an officer
    // page hides the reason. An officer is allowed to read the explanation they
    // wrote. Member leakage is the requirement.
    for (const path of [
      `${CSF_ORGANIZATION_PATH}?tab=csf-home`,
      `${CSF_ORGANIZATION_PATH}?tab=csf-profile`,
      `${CSF_ORGANIZATION_PATH}?tab=csf-submissions`,
    ]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const html = await page.content();
      expect(html).not.toContain(EXPLAINED_REASON);
      expect(html).not.toContain(SHEET_FIXTURE_PREFIX);
      // Staged colours are evidence, not member-facing state.
      expect(html).not.toContain("#d9ead3");
      expect(html).not.toContain("in the Sheet · not published yet");
    }

    expectNoBrowserFailures(failures);
  });
});

test.describe("the Done and decision filters", () => {
  test("each filter narrows the roster to the rows it names", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "adviser");
    await openApplications(page);

    const filter = page.getByRole("combobox", { name: "Sheet decision" });
    await expect(filter).toBeVisible();

    async function choose(label: string) {
      await filter.click();
      await page.getByRole("option", { name: label, exact: true }).click();
    }

    // Done is the terminal verdicts. Unreviewed is not one of them.
    await choose("Done");
    await expect(
      rosterRow(page, applicants.byRole.accepted.lastName),
    ).toBeVisible();
    await expect(
      rosterRow(page, applicants.byRole.rejected.lastName),
    ).toBeVisible();
    await expect(
      rosterRow(page, applicants.byRole.unreviewed.lastName),
    ).toHaveCount(0);

    await choose("Not done");
    await expect(
      rosterRow(page, applicants.byRole.unreviewed.lastName),
    ).toBeVisible();
    await expect(
      rosterRow(page, applicants.byRole.accepted.lastName),
    ).toHaveCount(0);

    await choose("Accepted");
    await expect(
      rosterRow(page, applicants.byRole.accepted.lastName),
    ).toBeVisible();
    await expect(
      rosterRow(page, applicants.byRole.rejected.lastName),
    ).toHaveCount(0);
    await expect(
      rosterRow(page, applicants.byRole.explained.lastName),
    ).toHaveCount(0);

    // The two rejections are separate filters, because they are separate
    // outcomes to the chapter.
    await choose("Rejected with reason");
    await expect(
      rosterRow(page, applicants.byRole.explained.lastName),
    ).toBeVisible();
    await expect(
      rosterRow(page, applicants.byRole.rejected.lastName),
    ).toHaveCount(0);

    await choose("Rejected");
    await expect(
      rosterRow(page, applicants.byRole.rejected.lastName),
    ).toBeVisible();
    await expect(
      rosterRow(page, applicants.byRole.explained.lastName),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });
});

test.describe("officer permissions", () => {
  test("an adviser gets the mode toggle, Configure, Sync and Release", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "adviser");
    await openApplications(page);

    await expect(
      panel(page).getByRole("button", { name: "Review in the app" }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Configure" }).first(),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Sync from Google Sheets" }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: /^Release \d+ decision/ }),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });

  test("decide_applications releases without carrying manage_settings", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(DESKTOP);
    // VP Membership decides applications but does not administer settings.
    await loginAs(page, "vpMembership");
    await openApplications(page);

    await expect(
      panel(page).getByRole("button", { name: /^Release \d+ decision/ }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("button", { name: "Configure" }),
    ).toHaveCount(0);
    await expect(
      panel(page).getByRole("button", { name: /^Review in the/ }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("a role without decide_applications cannot release", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(DESKTOP);
    // The Treasurer template reads applications and is documented as unable to
    // decide them.
    await loginAs(page, "treasurer");
    await openApplications(page);

    await expect(
      panel(page).getByRole("button", { name: /^Release/ }),
    ).toHaveCount(0);
    await expect(
      panel(page).getByRole("button", { name: "Configure" }),
    ).toHaveCount(0);
    await expect(
      panel(page).getByRole("button", { name: /^Review in the/ }),
    ).toHaveCount(0);
    // Reading the roster is still allowed, so the panel itself is present.
    await expect(panel(page)).toContainText(
      "Applications are reviewed in the Sheet",
    );

    expectNoBrowserFailures(failures);
  });
});

test.describe("release, then a later sync that takes it back", () => {
  test("release publishes the decided rows and leaves the rest pending", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "adviser");
    await openApplications(page);

    await panel(page)
      .getByRole("button", { name: /^Release \d+ decision/ })
      .click();

    // The panel stops claiming nothing is published once the release lands.
    await expect(panel(page)).toContainText(/Released \d+ time/);
    await expect(panel(page)).not.toContainText(
      "Nothing has been published for this semester yet.",
    );
    await expect(
      rosterRow(page, applicants.byRole.accepted.lastName),
    ).toContainText("Accepted in the Sheet · published");

    // Release creates the membership as `accepted`. `active` is a later
    // transition the chapter makes for itself, not something publishing does,
    // so asserting it here would be asserting a state the RPC never produces.
    const accepted = await publishedState(fixture, applicants.byRole.accepted);
    expect(accepted.applicationStatus).toBe("accepted");
    expect(accepted.membershipStatus).toBe("accepted");

    // A rejected applicant who was never a member gets no membership row at
    // all: the decision only revokes an existing pending or accepted one. Not
    // `active` would also pass on an accepted membership, which is the outcome
    // this is meant to rule out.
    const rejected = await publishedState(fixture, applicants.byRole.rejected);
    expect(rejected.applicationStatus).toBe("rejected");
    expect(rejected.membershipStatus).toBeNull();

    // An uncoloured row is not a verdict, so release leaves it alone.
    const unreviewed = await publishedState(
      fixture,
      applicants.byRole.unreviewed,
    );
    expect(unreviewed.applicationStatus).toBe("submitted");
    expect(unreviewed.membershipStatus).toBeNull();

    // The yellow row with no reason is held back rather than published.
    const blocked = await publishedState(fixture, applicants.byRole.blocked);
    expect(blocked.applicationStatus).toBe("submitted");

    expectNoBrowserFailures(failures);
  });

  test("a held row reports why it was held", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "adviser");
    await openApplications(page);

    await panel(page)
      .getByRole("button", { name: /^Release \d+ decision/ })
      .click();

    await expect(panel(page)).toContainText(/row.* held back/);
    await expect(panel(page)).toContainText("missing_yellow_reason");

    expectNoBrowserFailures(failures);
  });

  test("a later sync flips an accepted member to rejected and removes access", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    const firstRelease = await releaseDecisions(fixture);
    expect(firstRelease.accepted).toBeGreaterThanOrEqual(1);

    const beforeCorrection = await publishedState(
      fixture,
      applicants.byRole.accepted,
    );
    expect(beforeCorrection.membershipStatus).toBe("accepted");

    // The officer recoloured the row red. A released row is corrected straight
    // away, without waiting for another release.
    await stageDecisions(fixture, [
      {
        applicant: applicants.byRole.accepted,
        status: "rejected",
        observedColor: "#f4cccc",
      },
    ]);

    const afterCorrection = await publishedState(
      fixture,
      applicants.byRole.accepted,
    );
    expect(afterCorrection.applicationStatus).toBe("rejected");
    // Revoked exactly. `not("active")` would have passed on a membership still
    // sitting at `accepted`, which is the access this correction has to remove.
    expect(afterCorrection.membershipStatus).toBe("revoked");

    await page.setViewportSize(DESKTOP);
    await loginAs(page, "adviser");
    await openApplications(page);
    await expect(
      rosterRow(page, applicants.byRole.accepted.lastName),
    ).toContainText("Rejected in the Sheet · published");

    expectNoBrowserFailures(failures);
  });

  test("uncolouring a released row retracts the publication", async () => {
    await stageTheFiveOutcomes();
    await releaseDecisions(fixture);
    expect(
      (await publishedState(fixture, applicants.byRole.accepted))
        .membershipStatus,
    ).toBe("accepted");

    // The officer cleared the fill. The chapter's instruction is that this
    // retracts the published outcome rather than leaving a stale acceptance.
    await stageDecisions(fixture, [
      {
        applicant: applicants.byRole.accepted,
        status: "unreviewed",
        observedColor: null,
      },
    ]);

    const retracted = await publishedState(fixture, applicants.byRole.accepted);
    expect(retracted.applicationStatus).toBe("needs_review");
    expect(retracted.membershipStatus).toBe("revoked");
  });
});

test.describe("source failure feedback", () => {
  test("Sync states that the workbook could not be read", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    const before = await termState(fixture);
    await page.setViewportSize(DESKTOP);
    await loginAs(page, "adviser");
    await openApplications(page);

    await panel(page)
      .getByRole("button", { name: "Sync from Google Sheets" })
      .click();

    // The isolated stack has no bound Drive token. The officer has to be told
    // that, because the alternative is a panel that looks like it finished
    // reviewing a semester it never read.
    const alert = page
      .getByRole("status")
      .or(page.locator("[data-sonner-toast]"));
    await expect(alert.first()).toBeVisible({ timeout: 20_000 });
    await expect(panel(page)).not.toContainText("0 changed · 0 unchanged");

    // A failed read changes no staged state.
    const after = await termState(fixture);
    expect(after.counts.released).toBe(before.counts.released);
    expect(after.releaseCount).toBe(before.releaseCount);

    expectNoBrowserFailures(failures);
  });
});

test.describe("mobile", () => {
  test("the panel and its controls stay usable at phone width", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(MOBILE);
    await loginAs(page, "adviser");
    await openApplications(page);

    await expect(panel(page)).toContainText(
      "Applications are reviewed in the Sheet",
    );
    const release = panel(page).getByRole("button", {
      name: /^Release \d+ decision/,
    });
    await expect(release).toBeVisible();

    // A control that is present but off-screen is not reachable on a phone.
    const box = await release.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width);

    await expect(
      rosterRow(page, applicants.byRole.accepted.lastName),
    ).toContainText("Accepted in the Sheet · not published yet");

    // The staged reason is no more visible on a phone than on a desktop.
    expect(await page.content()).not.toContain(EXPLAINED_REASON);

    expectNoBrowserFailures(failures);
  });

  test("release works from a phone and the roster reflects it", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheFiveOutcomes();
    await page.setViewportSize(MOBILE);
    await loginAs(page, "adviser");
    await openApplications(page);

    await panel(page)
      .getByRole("button", { name: /^Release \d+ decision/ })
      .click();
    await expect(panel(page)).toContainText(/Released \d+ time/);
    await expect(
      rosterRow(page, applicants.byRole.accepted.lastName),
    ).toContainText("Accepted in the Sheet · published");

    expect(
      (await publishedState(fixture, applicants.byRole.accepted))
        .membershipStatus,
    ).toBe("accepted");

    expectNoBrowserFailures(failures);
  });
});
