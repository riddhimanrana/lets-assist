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
  type SheetApplicant,
  type SheetApplicants,
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
/**
 * Allocated per test. A staged decision is keyed on its application and cannot
 * be deleted, so a test that reused an application id would inherit whatever
 * the last one released. Fresh identities are the only clean start available
 * without weakening the table's ACL.
 */
let applicants: SheetApplicants;

async function stageTheOutcomes() {
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
  ]);
}

/**
 * The identities this viewer must not be shown: every scenario applicant except
 * themselves.
 *
 * Checking the fixture prefix instead would be wrong, and was. Every applicant's
 * `lastName` is built as `${SHEET_FIXTURE_PREFIX} ${role} ${token}`, so the
 * prefix appears in the signed-in applicant's OWN name and legitimately renders
 * on their own profile. Asserting the page never contains it either fails on a
 * correct page or, worse, passes only because the viewer's own name was missing
 * from a page that should have shown it.
 */
function otherApplicantIdentities(viewer: SheetApplicant) {
  return applicants.all
    .filter((applicant) => applicant.role !== viewer.role)
    .flatMap((applicant) => [applicant.lastName, applicant.email]);
}

/**
 * The two regions that state a member's semester status, both from
 * `memberSemesterStatus`, so every status label renders twice on this page.
 * Positive assertions name the region they mean; negative ones stay page-wide.
 */
const profileSummary = (page: Page) => page.getByLabel("CSF member profile");
const selectedSemester = (page: Page) =>
  page.getByLabel("Selected semester status and progress");

/**
 * The label a semester's tab and panel heading carry.
 *
 * Tabs are keyed on the ledger entry id, which equals the term id only when the
 * chapter's term reached the profile's term list: `buildTermLedger` registers
 * the cohort's eight generated semesters and a seeded membership merges into
 * one by code. The label is the identity both paths share.
 */
async function semesterLabel(termId: string) {
  const term = await fixture.admin
    .schema("plugin_data")
    .from("csf_terms")
    .select("label, code")
    .eq("organization_id", fixture.organizationId)
    .eq("id", termId)
    .single();
  if (term.error) throw new Error(term.error.message);
  const row = term.data as { label: string | null; code: string | null };
  const label = (row.label ?? row.code ?? "").trim();
  if (!label) throw new Error(`Term ${termId} has neither a label nor a code.`);
  return label;
}

/**
 * Everything an applicant must not be able to read before release, checked on
 * every member tab while signed in as `viewer`.
 */
async function expectNoStagedLeak(page: Page, viewer: SheetApplicant) {
  const strangers = otherApplicantIdentities(viewer);
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
    // Nor should one applicant learn about another. Their own name may appear;
    // this is their own profile.
    for (const stranger of strangers) {
      expect(html).not.toContain(stranger);
    }
  }
}

/**
 * An organization member with no CSF profile link at all.
 *
 * `linkApplicantAccounts` deliberately gives the `unreviewed` applicant no
 * account, so there was no way to sign in as an unlinked person. This builds one
 * locally, following the same conventions the fixture uses: a `@local.test`
 * address carrying the scenario token, the run-scoped isolated password, and an
 * `active` organization membership so the CSF tabs are reachable at all.
 *
 * The one thing it deliberately does NOT create is the verified
 * `csf_profile_accounts` row. That absence is the whole point: this session
 * reaches the member surfaces and resolves to no CSF profile, which is exactly
 * the state an applicant is in before an officer connects them.
 */
async function createUnlinkedAccount(
  applicant: SheetApplicant,
): Promise<string> {
  const email = `e2e.sheet.unlinked.${applicants.token}@local.test`;
  const payload = {
    password,
    email_confirm: true,
    user_metadata: { full_name: `Fictional unlinked ${applicant.role}` },
  };

  const { data: existingUsers, error: listError } =
    await fixture.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) throw new Error(listError.message);
  const existing = existingUsers.users.find((user) => user.email === email);

  const { data, error } = await (existing
    ? fixture.admin.auth.admin.updateUserById(existing.id, payload)
    : fixture.admin.auth.admin.createUser({ email, ...payload }));
  if (error) throw new Error(error.message);
  const userId = data.user!.id;

  const membership = await fixture.admin.from("organization_members").upsert(
    {
      organization_id: fixture.organizationId,
      user_id: userId,
      role: "member",
      status: "active",
    },
    { onConflict: "organization_id,user_id" },
  );
  if (membership.error) throw new Error(membership.error.message);

  // Proving the absence rather than assuming it: if anything ever links this
  // account, the journey below stops being an unlinked one and the test would
  // silently change meaning.
  const links = await fixture.admin
    .schema("plugin_data")
    .from("csf_profile_accounts")
    .select("id")
    .eq("organization_id", fixture.organizationId)
    .eq("user_id", userId);
  if (links.error) throw new Error(links.error.message);
  expect(links.data ?? []).toEqual([]);

  return email;
}

test.beforeAll(async () => {
  fixture = await loadSheetDecisionFixture();
  password = localTestPassword();
});

test.afterAll(async () => {
  await restoreAppReview(fixture);
});

// Playwright reads the hook's fixture list off the first parameter and rejects
// anything that is not a destructuring pattern, so a named placeholder fails at
// discovery time. The empty pattern is the documented way to take `testInfo`
// while requesting no fixtures; `no-empty-pattern` is off for this line only.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(async ({}, testInfo) => {
  applicants = await resetSheetDecisionFixture(fixture, testInfo.title);
  await linkApplicantAccounts(fixture, applicants, password);
});

test.describe("before any release", () => {
  test("an account with no CSF profile link is told nothing at all", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();

    // A real unlinked session, not a linked one standing in for it. This
    // account is an organization member and reaches the CSF tabs; what it has
    // no claim to is any CSF profile, so no applicant's record is its own.
    const unlinkedEmail = await createUnlinkedAccount(
      applicants.byRole.unreviewed,
    );
    await loginWithEmail(page, unlinkedEmail);

    for (const path of MEMBER_TABS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const html = await page.content();
      // No applicant's identity, including the one whose email this borrows a
      // naming convention from.
      for (const applicant of applicants.all) {
        expect(html).not.toContain(applicant.lastName);
        expect(html).not.toContain(applicant.email);
      }
      // And none of the staged vocabulary or evidence.
      expect(html).not.toContain(EXPLAINED_REASON);
      expect(html).not.toContain("#d9ead3");
      expect(html).not.toContain("#f4cccc");
      expect(html).not.toContain("#fff2cc");
      expect(html).not.toContain("in the Sheet");
      expect(html).not.toContain("not published yet");
      // Nothing resolves to a decision for a session with no profile.
      expect(html).not.toContain("Approved by CSF officers");
      expect(html).not.toContain("Application not approved");
    }

    expectNoBrowserFailures(failures);
  });

  test("one applicant is never shown another applicant's record", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();

    // The privacy half the unlinked journey above used to stand in for, kept
    // separate because it proves a different thing: a legitimately signed-in
    // applicant still sees only themselves.
    await loginWithEmail(page, applicants.byRole.accepted.email);
    for (const path of MEMBER_TABS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const html = await page.content();
      for (const stranger of otherApplicantIdentities(
        applicants.byRole.accepted,
      )) {
        expect(html).not.toContain(stranger);
      }
    }

    // The uncoloured applicant was untouched by staging in the database too.
    const state = await publishedState(fixture, applicants.byRole.unreviewed);
    expect(state.applicationStatus).toBe("submitted");
    expect(state.membershipStatus).toBeNull();

    expectNoBrowserFailures(failures);
  });

  test("a linked applicant staged as accepted sees no acceptance", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await loginWithEmail(page, applicants.byRole.accepted.email);

    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    // A staged acceptance grants nothing, so the semester still reads as under
    // review rather than approved.
    await expect(page.getByText("Approved by CSF officers")).toHaveCount(0);
    await expect(
      profileSummary(page).getByText("Under officer review"),
    ).toBeVisible();
    await expectNoStagedLeak(page, applicants.byRole.accepted);

    expect(
      (await publishedState(fixture, applicants.byRole.accepted))
        .membershipStatus,
    ).toBeNull();

    expectNoBrowserFailures(failures);
  });

  test("a linked applicant staged as rejected sees no rejection", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await loginWithEmail(page, applicants.byRole.rejected.email);

    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    // The copy a published rejection actually renders, from `decisionCopy` in
    // `CsfMemberWorkspaceModel`. A staged rejection must not reach it, and this
    // is the string that would appear if it did.
    expect(html).not.toContain("Application not approved");
    // Two phrases the member surfaces do not render today, kept as guards
    // against a future rejection label taking either shape.
    expect(html).not.toContain("Rejected");
    expect(html).not.toContain("Not accepted");
    await expectNoStagedLeak(page, applicants.byRole.rejected);

    expectNoBrowserFailures(failures);
  });

  test("the yellow applicant cannot read the officer explanation yet", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await loginWithEmail(page, applicants.byRole.explained.email);

    // This is the sharpest case. The officer wrote a reason next to this
    // person's row, and it is the officer's private note until release.
    await expectNoStagedLeak(page, applicants.byRole.explained);

    expectNoBrowserFailures(failures);
  });

  test("permitted history stays readable while the term is unreleased", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    const priorTermId = await seedPriorSemesterRecord(
      fixture,
      applicants.byRole.explained,
    );
    const priorSemester = await semesterLabel(priorTermId);
    await stageTheOutcomes();
    await loginWithEmail(page, applicants.byRole.explained.email);

    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    // The page opens on the current semester, because
    // `resolveDefaultProfileTermId` prefers it once it holds any record and a
    // staged application is one. Last semester has to be selected before
    // anything can be asserted about it.
    const priorTab = page
      .getByRole("tablist", { name: "Member semesters" })
      .getByRole("tab", { name: priorSemester, exact: true });
    await priorTab.click();
    await expect(priorTab).toHaveAttribute("aria-selected", "true");

    // One panel renders, for the selected semester, and each tab names its
    // panel through `aria-controls`. Scoping to it is what binds the assertion
    // to last semester rather than to the header badge, which follows the same
    // selection.
    const panelId = await priorTab.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const priorPanel = page.locator(`[id="${panelId}"]`);
    await expect(
      priorPanel.getByRole("heading", { name: priorSemester }),
    ).toBeVisible();
    // Withholding this semester's decision must not withhold last semester's
    // completed record.
    await expect(priorPanel.getByText("Semester completed")).toBeVisible();

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

    const state = await publishedState(fixture, applicants.byRole.accepted);
    expect(state.applicationStatus).toBe("accepted");
    // `csf_decide_term_application_policy_base` inserts the membership as
    // 'accepted'. Nothing in the release path promotes it to 'active', and the
    // member gate in `CsfMemberSubmissionsView` accepts either, so 'accepted'
    // is the published state this journey actually produces.
    expect(state.membershipStatus).toBe("accepted");

    await loginWithEmail(page, applicants.byRole.accepted.email);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    // Both regions state the verdict, so each is asserted by name rather than
    // taken with `.first()`.
    await expect(
      profileSummary(page).getByText("Approved by CSF officers"),
    ).toBeVisible();
    // Named heading, so the badge belongs to the semester that was released.
    await expect(
      selectedSemester(page).getByRole("heading", {
        name: await semesterLabel(fixture.termId),
      }),
    ).toBeVisible();
    await expect(
      selectedSemester(page).getByText("Approved by CSF officers"),
    ).toBeVisible();

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

    const state = await publishedState(fixture, applicants.byRole.rejected);
    expect(state.applicationStatus).toBe("rejected");
    // Null, not 'revoked'. A first decision of rejected has no membership to
    // revoke: `csf_decide_term_application_policy_base` moves an existing
    // `status IN ('pending', 'accepted')` row to 'revoked' and inserts none,
    // so an applicant who was never a member keeps no row at all. 'revoked' is
    // the right value only once an acceptance has been published, and those
    // assertions stay where they belong, in the stale-access journeys below.
    expect(state.membershipStatus).toBeNull();

    await loginWithEmail(page, applicants.byRole.rejected.email);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    // The negative stays page-wide: no region may call this person approved.
    await expect(page.getByText("Approved by CSF officers")).toHaveCount(0);
    // A released rejection is stated, not left blank. `memberSemesterStatus`
    // resolves it off `decision_status`, so both regions carry it.
    await expect(
      profileSummary(page).getByText("Application not approved"),
    ).toBeVisible();
    await expect(
      selectedSemester(page).getByText("Application not approved"),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });

  test("a red rejection carries no explanation, because none was written", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    await loginWithEmail(page, applicants.byRole.rejected.email);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    // The yellow applicant's reason belongs to the yellow applicant.
    expect(await page.content()).not.toContain(EXPLAINED_REASON);

    expectNoBrowserFailures(failures);
  });

  test("uncoloured stays pending through a release", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    const state = await publishedState(fixture, applicants.byRole.unreviewed);
    expect(state.applicationStatus).toBe("submitted");
    expect(state.membershipStatus).toBeNull();

    await loginWithEmail(page, applicants.byRole.accepted.email);
    await page.goto(HOME, { waitUntil: "domcontentloaded" });
    const html = await page.content();
    for (const stranger of otherApplicantIdentities(
      applicants.byRole.accepted,
    )) {
      expect(html).not.toContain(stranger);
    }

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
      (await publishedState(fixture, applicants.byRole.accepted))
        .membershipStatus,
    ).toBe("accepted");

    // The officer recoloured the row red. A released row is corrected straight
    // away, with no second release.
    await stageDecisions(fixture, [
      {
        applicant: applicants.byRole.accepted,
        status: "rejected",
        observedColor: "#f4cccc",
      },
    ]);

    const corrected = await publishedState(fixture, applicants.byRole.accepted);
    expect(corrected.applicationStatus).toBe("rejected");
    expect(corrected.membershipStatus).toBe("revoked");

    await loginWithEmail(page, applicants.byRole.accepted.email);
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
        applicant: applicants.byRole.accepted,
        status: "unreviewed",
        observedColor: null,
      },
    ]);

    // Withdrawing a published decision revokes the membership it granted.
    expect(
      (await publishedState(fixture, applicants.byRole.accepted))
        .membershipStatus,
    ).toBe("revoked");

    await loginWithEmail(page, applicants.byRole.accepted.email);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Approved by CSF officers")).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("a completed prior semester survives a current-term revocation", async () => {
    const priorTermId = await seedPriorSemesterRecord(
      fixture,
      applicants.byRole.accepted,
    );
    await stageTheOutcomes();
    await releaseDecisions(fixture);
    await stageDecisions(fixture, [
      {
        applicant: applicants.byRole.accepted,
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
      .eq("profile_id", applicants.byRole.accepted.profileId)
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
 * `memberSemesterStatus` names the published outcome in both profile regions,
 * and `ApplicationDecisionReason` prints the officer's words in the selected
 * semester, for a released rejection only. `CsfMemberSubmissionsView` gates on
 * `termMembership.status` being accepted or active, and says so.
 */
test.describe("member guards", () => {
  test("the yellow applicant reads the officer explanation after release", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    await loginWithEmail(page, applicants.byRole.explained.email);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });

    // A yellow mark is a rejection *with* an explanation. Once the chapter
    // publishes it, the student is owed those words, in the semester they
    // belong to.
    await expect(
      profileSummary(page).getByText("Application not approved"),
    ).toBeVisible();
    await expect(
      selectedSemester(page).getByText("Application not approved"),
    ).toBeVisible();
    await expect(
      selectedSemester(page).getByText("Why this application was not approved"),
    ).toBeVisible();
    await expect(
      selectedSemester(page).getByText(EXPLAINED_REASON),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });

  test("a red rejection publishes without inventing an explanation", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await releaseDecisions(fixture);

    await loginWithEmail(page, applicants.byRole.rejected.email);
    await page.goto(PROFILE, { waitUntil: "domcontentloaded" });

    await expect(
      profileSummary(page).getByText("Application not approved"),
    ).toBeVisible();
    // The yellow applicant's words belong to the yellow applicant.
    expect(await page.content()).not.toContain(EXPLAINED_REASON);

    expectNoBrowserFailures(failures);
  });

  test("member tools refuse before the term is released", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await stageTheOutcomes();
    await loginWithEmail(page, applicants.byRole.accepted.email);

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

    await loginWithEmail(page, applicants.byRole.accepted.email);
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
        applicant: applicants.byRole.accepted,
        status: "rejected",
        observedColor: "#f4cccc",
      },
    ]);
    expect(
      (await publishedState(fixture, applicants.byRole.accepted))
        .membershipStatus,
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
