import { expect, test, type Page } from "@playwright/test";

import {
  APPLICANTS,
  APPLICANT_ACCOUNTS,
  EXPLAINED_REASON,
  SHEET_FIXTURE_PREFIX,
  linkApplicantAccounts,
  loadSheetDecisionFixture,
  publishedState,
  releaseDecisions,
  resetSheetDecisionFixture,
  restoreAppReview,
  seedPriorSemesterRecord,
  stageDecisions,
  type SheetDecisionFixture,
} from "./sheet-decision-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  localTestPassword,
  loginWithEmail,
  watchBrowserFailures,
} from "./helpers";

/**
 * What each applicant sees of their own application, signed in as themselves.
 *
 * The companion spec watches the officer surface. This one watches the people
 * the decision is about, because that is where the chapter's rule actually
 * bites: an officer may read a staged rejection and its reason, and the
 * applicant may not, until the semester is released.
 *
 * Officer privacy is not the requirement. Member leakage is. So nothing here
 * asserts that an officer page hides a reason, and everything here asserts that
 * an applicant's own pages do.
 *
 * Accounts are created at run time against the validated isolated stack, with
 * the run-scoped fixture password and `@local.test` addresses. Each is linked
 * to its CSF profile as a verified connection, which is what makes the member
 * surfaces resolve to that person. The uncoloured applicant is deliberately
 * left unlinked, because an applicant with no account is a real case.
 */

const HOME = `${CSF_ORGANIZATION_PATH}?tab=csf-home`;
const PROFILE = `${CSF_ORGANIZATION_PATH}?tab=csf-profile`;
const SUBMISSIONS = `${CSF_ORGANIZATION_PATH}?tab=csf-submissions`;
const MEMBER_TABS = [HOME, PROFILE, SUBMISSIONS];

let fixture: SheetDecisionFixture;
let password: string;

async function stageTheOutcomes() {
  return stageDecisions(fixture, [
    {
      applicant: APPLICANTS.accepted,
      status: "accepted",
      observedColor: "#d9ead3",
    },
    {
      applicant: APPLICANTS.rejected,
      status: "rejected",
      observedColor: "#f4cccc",
    },
    {
      applicant: APPLICANTS.explained,
      status: "rejected_with_explanation",
      observedColor: "#fff2cc",
      reason: EXPLAINED_REASON,
    },
    {
      applicant: APPLICANTS.unreviewed,
      status: "unreviewed",
      observedColor: null,
    },
  ]);
}

/** Everything an applicant must not be able to read before release. */
async function expectNoStagedLeak(page: Page) {
  for (const path of MEMBER_TABS) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    expect(html).not.toContain(EXPLAINED_REASON);
    // The workbook fill is evidence, not a member-facing fact.
    expect(html).not.toContain("#d9ead3");
    expect(html).not.toContain("#f4cccc");
    expect(html).not.toContain("#fff2cc");
    // The officer's staged vocabulary must not reach the applicant either.
    expect(html).not.toContain("in the Sheet");
    expect(html).not.toContain("not published yet");
    // Nor should one applicant learn about another.
    expect(html).not.toContain(SHEET_FIXTURE_PREFIX);
  }
}

test.beforeAll(async () => {
  fixture = await loadSheetDecisionFixture();
  password = localTestPassword();
});

test.afterAll(async () => {
  await restoreAppReview(fixture);
});

test.beforeEach(async () => {
  await resetSheetDecisionFixture(fixture);
  await linkApplicantAccounts(fixture, password);
});

test.describe("before any release", () => {
  test("an unlinked applicant is never told a decision exists", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();

    // The uncoloured applicant has no account at all. Signing in as a linked
    // applicant must not surface them, and the public surface must not either.
    await loginWithEmail(page, APPLICANT_ACCOUNTS.accepted);
    for (const path of MEMBER_TABS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(await page.content()).not.toContain(
        APPLICANTS.unreviewed.lastName,
      );
    }

    // Staging touched nothing about them in the database either.
    const state = await publishedState(fixture, APPLICANTS.unreviewed);
    expect(state.applicationStatus).toBe("submitted");
    expect(state.membershipStatus).toBeNull();

    expectNoBrowserFailures(failures);
  });

  test("a linked applicant staged as accepted sees no acceptance", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await loginWithEmail(page, APPLICANT_ACCOUNTS.accepted);

    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    // A staged acceptance grants nothing, so the semester still reads as under
    // review rather than approved.
    await expect(page.getByText("Approved by CSF officers")).toHaveCount(0);
    await expectNoStagedLeak(page);

    expect(
      (await publishedState(fixture, APPLICANTS.accepted)).membershipStatus,
    ).toBeNull();

    expectNoBrowserFailures(failures);
  });

  test("a linked applicant staged as rejected sees no rejection", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await loginWithEmail(page, APPLICANT_ACCOUNTS.rejected);

    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    expect(html).not.toContain("Rejected");
    expect(html).not.toContain("Not accepted");
    await expectNoStagedLeak(page);

    expectNoBrowserFailures(failures);
  });

  test("the yellow applicant cannot read the officer explanation yet", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await loginWithEmail(page, APPLICANT_ACCOUNTS.explained);

    // This is the sharpest case. The officer wrote a reason next to this
    // person's row, and it is the officer's private note until release.
    await expectNoStagedLeak(page);

    expectNoBrowserFailures(failures);
  });

  test("permitted history stays readable while the term is unreleased", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await seedPriorSemesterRecord(fixture, "explained");
    await stageTheOutcomes();
    await loginWithEmail(page, APPLICANT_ACCOUNTS.explained);

    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    // Withholding this semester's decision must not withhold last semester's
    // completed record.
    await expect(page.getByText("Semester completed")).toBeVisible();

    expectNoBrowserFailures(failures);
  });
});

test.describe("after release", () => {
  test("the accepted applicant is approved and gains membership", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    const state = await publishedState(fixture, APPLICANTS.accepted);
    expect(state.applicationStatus).toBe("accepted");
    expect(state.membershipStatus).toBe("active");

    await loginWithEmail(page, APPLICANT_ACCOUNTS.accepted);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Approved by CSF officers")).toBeVisible();

    // Even a published acceptance carries none of the workbook's evidence.
    const html = await page.content();
    expect(html).not.toContain("#d9ead3");
    expect(html).not.toContain("in the Sheet");

    expectNoBrowserFailures(failures);
  });

  test("the red applicant stays rejected and is not approved", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    const state = await publishedState(fixture, APPLICANTS.rejected);
    expect(state.applicationStatus).toBe("rejected");
    expect(state.membershipStatus).not.toBe("active");

    await loginWithEmail(page, APPLICANT_ACCOUNTS.rejected);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Approved by CSF officers")).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("a red rejection carries no explanation, because none was written", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    await loginWithEmail(page, APPLICANT_ACCOUNTS.rejected);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    // The yellow applicant's reason belongs to the yellow applicant.
    expect(await page.content()).not.toContain(EXPLAINED_REASON);

    expectNoBrowserFailures(failures);
  });

  test("uncoloured stays pending through a release", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    const state = await publishedState(fixture, APPLICANTS.unreviewed);
    expect(state.applicationStatus).toBe("submitted");
    expect(state.membershipStatus).toBeNull();

    await loginWithEmail(page, APPLICANT_ACCOUNTS.accepted);
    await page.goto(HOME, { waitUntil: "domcontentloaded" });
    expect(await page.content()).not.toContain(APPLICANTS.unreviewed.lastName);

    expectNoBrowserFailures(failures);
  });
});

test.describe("stale access after a later sync", () => {
  test("a published acceptance turned red removes the member's access", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);
    expect(
      (await publishedState(fixture, APPLICANTS.accepted)).membershipStatus,
    ).toBe("active");

    // The officer recoloured the row red. A released row is corrected straight
    // away, with no second release.
    await stageDecisions(fixture, [
      {
        applicant: APPLICANTS.accepted,
        status: "rejected",
        observedColor: "#f4cccc",
      },
    ]);

    const corrected = await publishedState(fixture, APPLICANTS.accepted);
    expect(corrected.applicationStatus).toBe("rejected");
    expect(corrected.membershipStatus).not.toBe("active");

    await loginWithEmail(page, APPLICANT_ACCOUNTS.accepted);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    // The page must stop calling them approved the moment the ledger does.
    await expect(page.getByText("Approved by CSF officers")).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("uncolouring a released row retracts it for the applicant too", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    await stageDecisions(fixture, [
      {
        applicant: APPLICANTS.accepted,
        status: "unreviewed",
        observedColor: null,
      },
    ]);

    expect(
      (await publishedState(fixture, APPLICANTS.accepted)).membershipStatus,
    ).not.toBe("active");

    await loginWithEmail(page, APPLICANT_ACCOUNTS.accepted);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Approved by CSF officers")).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("a completed prior semester survives a current-term revocation", async () => {
    const priorTermId = await seedPriorSemesterRecord(fixture, "accepted");
    await stageTheOutcomes();
    await releaseDecisions(fixture);
    await stageDecisions(fixture, [
      {
        applicant: APPLICANTS.accepted,
        status: "rejected",
        observedColor: "#f4cccc",
      },
    ]);

    const prior = await fixture.admin
      .schema("plugin_data")
      .from("csf_term_memberships")
      .select("status")
      .eq("organization_id", fixture.organizationId)
      .eq("term_id", priorTermId)
      .eq("profile_id", APPLICANTS.accepted.profileId)
      .maybeSingle();
    if (prior.error) throw new Error(prior.error.message);
    // A completed outcome is history. Nothing in this term revokes it.
    expect(prior.data?.status).toBe("completed");
  });
});

/**
 * The guards this lane implemented, against the copy the member surfaces
 * actually render.
 *
 * `decisionCopy` in `CsfMemberWorkspaceModel` supplies the status label and
 * `CsfMemberWorkspaceViews` prefers the application's own `decision_reason` as
 * the row detail, so a released yellow rejection reads as "Application not
 * approved" with the officer's words underneath. `CsfMemberSubmissionsView`
 * gates on `termMembership.status` being accepted or active, and says so.
 */
test.describe("member guards", () => {
  test("the yellow applicant reads the officer explanation after release", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    await loginWithEmail(page, APPLICANT_ACCOUNTS.explained);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });

    // A yellow mark is a rejection *with* an explanation. Once the chapter
    // publishes it, the student is owed those words.
    await expect(page.getByText("Application not approved")).toBeVisible();
    await expect(page.getByText(EXPLAINED_REASON)).toBeVisible();

    expectNoBrowserFailures(failures);
  });

  test("a red rejection publishes without inventing an explanation", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    await loginWithEmail(page, APPLICANT_ACCOUNTS.rejected);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Application not approved")).toBeVisible();
    // The yellow applicant's words belong to the yellow applicant.
    expect(await page.content()).not.toContain(EXPLAINED_REASON);

    expectNoBrowserFailures(failures);
  });

  test("member tools refuse before the term is released", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await loginWithEmail(page, APPLICANT_ACCOUNTS.accepted);

    await page.goto(SUBMISSIONS, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText(
        "Your current semester membership must be approved before you can submit points.",
      ),
    ).toBeVisible();
    // A staged acceptance is not an acceptance, so there is nothing to click.
    await expect(
      page.getByRole("button", { name: "Submit points" }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("a stale page loses its tools once the officer recolours the row", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    await loginWithEmail(page, APPLICANT_ACCOUNTS.accepted);
    await page.goto(SUBMISSIONS, { waitUntil: "domcontentloaded" });
    // Released and accepted: the refusal copy is absent, so the transition
    // below is what this test is actually watching.
    await expect(
      page.getByText(
        "Your current semester membership must be approved before you can submit points.",
      ),
    ).toHaveCount(0);

    // The applicant keeps the page open while the officer recolours the row
    // red. The sync applies it to the already-published row immediately.
    await stageDecisions(fixture, [
      {
        applicant: APPLICANTS.accepted,
        status: "rejected",
        observedColor: "#f4cccc",
      },
    ]);
    expect(
      (await publishedState(fixture, APPLICANTS.accepted)).membershipStatus,
    ).toBe("revoked");

    // Whatever the stale page still shows, the next thing the member asks the
    // server for has to refuse. The action layer refuses a stale post too;
    // that is covered by `member-rejected-term-guard.test.ts` in the plugin,
    // which drives the real submit action with a revoked membership.
    await page.goto(SUBMISSIONS, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText(
        "Your current semester membership must be approved before you can submit points.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Submit points" }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });
});
