import { expect, test, type Page } from "@playwright/test";
import {
  EXPLAINED_REASON,
  linkApplicantAccounts,
  loadSheetDecisionFixture,
  publishedState,
  releaseDecisions,
  resetSheetDecisionFixture,
  restoreAppReview,
  seedPriorSemesterRecord,
  stageDecisions,
  type SheetApplicants,
  type SheetDecisionFixture,
} from "./sheet-decision-fixtures";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  expectNoHorizontalOverflow,
  localTestPassword,
  loginWithEmail,
  watchBrowserFailures,
} from "./helpers";

const PROFILE = `${CSF_ORGANIZATION_PATH}?tab=csf-profile`;
const memberTabs = ["csf-home", "csf-profile", "csf-submissions"];
let fixture: SheetDecisionFixture;
let applicants: SheetApplicants;
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
      applicant: applicants.byRole.unreviewed,
      status: "unreviewed",
      observedColor: null,
    },
  ]);
}
async function expectPrivateEvidenceAbsent(
  page: Page,
  role: "accepted" | "rejected" | "explained",
) {
  const html = await page.content();
  for (const applicant of applicants.all.filter(
    (candidate) => candidate.role !== role,
  )) {
    expect(html).not.toContain(applicant.email);
    expect(html).not.toContain(applicant.lastName);
  }
  expect(html).not.toContain(EXPLAINED_REASON);
  expect(html).not.toContain("#fff2cc");
  expect(html).not.toContain("not published yet");
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
  await linkApplicantAccounts(fixture, applicants, localTestPassword());
});

for (const width of [1280, 390]) {
  for (const role of ["accepted", "rejected", "explained"] as const) {
    test(`${role} applicant sees no private staging or comments at ${width}px`, async ({
      page,
    }) => {
      const failures = watchBrowserFailures(page);
      await stageOutcomes();
      await page.setViewportSize({ width, height: 900 });
      await loginWithEmail(page, applicants.byRole[role].email);
      for (const tab of memberTabs) {
        await page.goto(`${CSF_ORGANIZATION_PATH}?tab=${tab}`);
        await expectPrivateEvidenceAbsent(page, role);
      }
      expect(
        (await publishedState(fixture, applicants.byRole[role]))
          .membershipStatus,
      ).toBeNull();
      await releaseDecisions(fixture);
      await page.goto(PROFILE);
      const summary = page.locator(`#csf-term-panel-${fixture.termId}`);
      await expect(summary).toBeVisible();
      if (role === "accepted") {
        await expect(
          summary.getByText("Approved by CSF officers"),
        ).toBeVisible();
        expect(
          (await publishedState(fixture, applicants.byRole[role]))
            .membershipStatus,
        ).toBe("accepted");
      } else if (role === "rejected") {
        await expect(
          summary.getByText("Application not approved"),
        ).toBeVisible();
        const { data, error } = await fixture.admin
          .schema("plugin_data")
          .from("csf_term_applications")
          .select("decision_reason")
          .eq("id", applicants.byRole[role].applicationId)
          .single();
        expect(error).toBeNull();
        expect(data?.decision_reason).toBeNull();
      } else {
        expect(
          (await publishedState(fixture, applicants.byRole[role]))
            .applicationStatus,
        ).toBe("submitted");
        await expect(summary.getByText("Application not approved")).toHaveCount(
          0,
        );
      }
      await expectPrivateEvidenceAbsent(page, role);
      await expectNoHorizontalOverflow(page);
      expectNoBrowserFailures(failures);
    });
  }
}
test("a new red proposal preserves the member's published access until release", async ({
  page,
}) => {
  await stageOutcomes();
  await releaseDecisions(fixture);
  await stageDecisions(fixture, [
    {
      applicant: applicants.byRole.accepted,
      status: "rejected",
      observedColor: "#f4cccc",
      reason: EXPLAINED_REASON,
    },
  ]);
  await loginWithEmail(page, applicants.byRole.accepted.email);
  await page.goto(PROFILE);
  await expect(
    page
      .locator(`#csf-term-panel-${fixture.termId}`)
      .getByText("Approved by CSF officers", { exact: true }),
  ).toBeVisible();
  expect(
    (await publishedState(fixture, applicants.byRole.accepted))
      .membershipStatus,
  ).toBe("accepted");
  await releaseDecisions(fixture);
  await page.reload();
  await expect(
    page
      .locator(`#csf-term-panel-${fixture.termId}`)
      .getByText("Application not approved", { exact: true }),
  ).toBeVisible();
  expect(
    (await publishedState(fixture, applicants.byRole.accepted))
      .membershipStatus,
  ).toBe("revoked");
  await expectPrivateEvidenceAbsent(page, "accepted");
});
test("a later release preserves completed prior semesters", async () => {
  const priorTermId = await seedPriorSemesterRecord(
    fixture,
    applicants.byRole.accepted,
  );
  await stageOutcomes();
  await releaseDecisions(fixture);
  await stageDecisions(fixture, [
    {
      applicant: applicants.byRole.accepted,
      status: "rejected",
      observedColor: "#f4cccc",
    },
  ]);
  await releaseDecisions(fixture);
  const { data, error } = await fixture.admin
    .schema("plugin_data")
    .from("csf_term_memberships")
    .select("status")
    .eq("organization_id", fixture.organizationId)
    .eq("term_id", priorTermId)
    .eq("profile_id", applicants.byRole.accepted.profileId)
    .single();
  expect(error).toBeNull();
  expect(data?.status).toBe("completed");
});
