import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import {
  CSF_ORGANIZATION_PATH,
  CSF_PUBLIC_PATH,
  expectNoBrowserFailures,
  expectNoPrivateBoundaryMarkers,
  localActors,
  loginAs,
  soleAccessibleAction,
  watchBrowserFailures,
} from "./helpers";

/**
 * Student onboarding through the permanent class join code, the only
 * remaining connection path after the onboarding-link system was retired.
 *
 * The seeded active code for the Class of 2028 is HAWK28. A signed-in student
 * types their name; the class is searched tolerantly (exact, nickname, or a
 * first-name prefix of three or more letters on an exact last name). One
 * unclaimed match connects when the student confirms it (Amendment 7). Two
 * matches, a claimed record, or email-only evidence go to the class's Members
 * tab "Accounts to connect" panel, where an officer resolves them.
 */

const classJoinCode = "HAWK28";
const noCodeConnectPath = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/connect`;
const connectPath = `${noCodeConnectPath}/${classJoinCode}`;
// Six characters from the production alphabet that no seeded fixture uses, so
// the page treats it as a well-formed but inactive code.
const unusableConnectPath = `${noCodeConnectPath}/ZZZZZ9`;

const runToken = Date.now().toString(36);
const reviewLastName = `Ambiguous-${runToken}`;

const cohortMembersPath = (cohortId: string) =>
  `${CSF_ORGANIZATION_PATH}?tab=csf-cohorts&csf_cohort=${cohortId}&csf_cohort_tab=members`;

type JoinFixture = {
  admin: SupabaseClient;
  accountName: { first: string; full: string; last: string };
  organizationId: string;
  cohortId: string;
  retirementTargetProfileId: string;
  userId: string;
};

async function loadJoinFixture(): Promise<JoinFixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const [{ data: organization, error: organizationError }, usersResult] =
    await Promise.all([
      admin
        .from("organizations")
        .select("id")
        .eq("username", "dvhs-csf")
        .single(),
      admin.auth.admin.listUsers({ page: 1, perPage: 1_000 }),
    ]);
  if (organizationError || !organization) {
    throw new Error(
      `Could not load the local DVHS CSF organization: ${organizationError?.message ?? "missing fixture"}`,
    );
  }
  if (usersResult.error) {
    throw new Error(
      `Could not load local auth fixtures: ${usersResult.error.message}`,
    );
  }

  const user = usersResult.data.users.find(
    (candidate) => candidate.email === localActors.outsider.email,
  );
  if (!user) throw new Error("The local outsider auth fixture is missing.");

  const { data: accountProfile, error: accountProfileError } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();
  const fullName = String(accountProfile?.full_name ?? "").trim();
  const accountNameParts = fullName.split(/\s+/u).filter(Boolean);
  if (accountProfileError || accountNameParts.length < 2) {
    throw new Error(
      `Could not load the outsider account name: ${accountProfileError?.message ?? "missing fixture"}`,
    );
  }

  const { data: cohort, error: cohortError } = await admin
    .schema("plugin_data")
    .from("csf_cohorts")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("graduation_year", 2028)
    .single();
  if (cohortError || !cohort) {
    throw new Error(
      `Could not load the Class of 2028 fixture: ${cohortError?.message ?? "missing fixture"}`,
    );
  }

  const { data: retirementTarget, error: retirementTargetError } = await admin
    .schema("plugin_data")
    .from("csf_profiles")
    .select("id")
    .eq("organization_id", organization.id)
    .eq("normalized_school_email", "nina.kapoor28@students.local.test")
    .single();
  if (retirementTargetError || !retirementTarget) {
    throw new Error(
      `Could not load the fixture retirement target: ${retirementTargetError?.message ?? "missing fixture"}`,
    );
  }

  return {
    admin,
    accountName: {
      first: accountNameParts[0],
      full: fullName,
      last: accountNameParts[accountNameParts.length - 1],
    },
    organizationId: organization.id,
    cohortId: cohort.id,
    retirementTargetProfileId: retirementTarget.id,
    userId: user.id,
  };
}

async function seedProfileWithoutEmail(
  fixture: JoinFixture,
  names: { first: string; last: string },
) {
  const plugin = fixture.admin.schema("plugin_data");
  const profileId = randomUUID();

  const { error: profileError } = await plugin.from("csf_profiles").insert({
    id: profileId,
    organization_id: fixture.organizationId,
    first_name: names.first,
    last_name: names.last,
    preferred_name: names.first,
    normalized_first_name: names.first.trim().toLowerCase(),
    normalized_last_name: names.last.trim().toLowerCase(),
    source_summary: { e2eFixture: true },
  });
  if (profileError) {
    throw new Error(
      `Could not seed the no-email join profile: ${profileError.message}`,
    );
  }

  const { error: cohortMembershipError } = await plugin
    .from("csf_profile_cohort_memberships")
    .insert({
      organization_id: fixture.organizationId,
      profile_id: profileId,
      cohort_id: fixture.cohortId,
      status: "active",
    });
  if (cohortMembershipError) {
    throw new Error(
      `Could not seed the no-email cohort membership: ${cohortMembershipError.message}`,
    );
  }

  return profileId;
}

async function cleanJoinFixture(fixture: JoinFixture) {
  const plugin = fixture.admin.schema("plugin_data");

  // The join RPC replays any prior request keyed on (organization, code,
  // user), so the outsider's requests must be removed for the next test to
  // exercise a fresh decision.
  const { error: requestsError } = await plugin
    .from("csf_profile_link_requests")
    .delete()
    .eq("organization_id", fixture.organizationId)
    .eq("user_id", fixture.userId);
  if (requestsError)
    throw new Error(`Could not clean join requests: ${requestsError.message}`);

  const { error: membershipError } = await fixture.admin
    .from("organization_members")
    .delete()
    .eq("organization_id", fixture.organizationId)
    .eq("user_id", fixture.userId);
  if (membershipError) {
    throw new Error(
      `Could not clean the organization membership: ${membershipError.message}`,
    );
  }

  // The outsider and every account link created here belong only to this
  // disposable isolated fixture. Remove those links so a second local run
  // starts clean instead of exercising the production revoked-link guard.
  const { error: accountError } = await plugin
    .from("csf_profile_accounts")
    .delete()
    .eq("organization_id", fixture.organizationId)
    .eq("user_id", fixture.userId);
  if (accountError)
    throw new Error(`Could not retire join accounts: ${accountError.message}`);

  // Connected joins are referenced by immutable audit rows, so browser
  // fixtures are de-identified rather than deleted. This preserves the
  // production audit contract while keeping the verified email unique for the
  // next run.
  const { error: profileError } = await plugin
    .from("csf_profiles")
    .update({
      record_status: "merged",
      merged_into_profile_id: fixture.retirementTargetProfileId,
      merged_at: new Date().toISOString(),
      merged_by: fixture.userId,
      merge_reason:
        "Retired synthetic browser class-code join fixture after verification.",
      personal_email: null,
      normalized_personal_email: null,
    })
    .eq("organization_id", fixture.organizationId)
    .eq("record_status", "active")
    .contains("source_summary", { e2eFixture: true });
  if (profileError)
    throw new Error(
      `Could not retire the join profile: ${profileError.message}`,
    );
}

async function seedProfileWithOutsiderEmail(
  fixture: JoinFixture,
  names: { first: string; last: string },
) {
  const plugin = fixture.admin.schema("plugin_data");
  const profileId = randomUUID();

  const { error: profileError } = await plugin.from("csf_profiles").insert({
    id: profileId,
    organization_id: fixture.organizationId,
    first_name: names.first,
    last_name: names.last,
    preferred_name: names.first,
    personal_email: localActors.outsider.email,
    normalized_first_name: names.first.toLowerCase(),
    normalized_last_name: names.last.toLowerCase(),
    normalized_personal_email: localActors.outsider.email,
    source_summary: { e2eFixture: true },
  });
  if (profileError)
    throw new Error(`Could not seed the join profile: ${profileError.message}`);

  const { error: cohortMembershipError } = await plugin
    .from("csf_profile_cohort_memberships")
    .insert({
      organization_id: fixture.organizationId,
      profile_id: profileId,
      cohort_id: fixture.cohortId,
      status: "active",
    });
  if (cohortMembershipError) {
    throw new Error(
      `Could not seed the cohort membership: ${cohortMembershipError.message}`,
    );
  }

  return profileId;
}

/** Opens the join dialog and searches one typed full name. */
async function searchJoinName(
  page: Page,
  names: { first: string; last: string },
) {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Join your class" });
  await expect(dialog).toBeVisible();
  // The field prefills asynchronously from the signed-in account and remounts
  // when the prefill arrives; wait for it before typing over it.
  const fullName = dialog.getByRole("textbox", { name: "Full name" });
  await expect(fullName).toBeVisible();
  await fullName.fill(`${names.first} ${names.last}`);
  await dialog.getByRole("button", { name: "Find my record" }).click();
  return dialog;
}

/**
 * Searches, then takes whichever branch the class actually offers: confirming
 * a matched record, or -- when nothing matches -- declaring new or returning
 * on the "We couldn't find your profile" screen. Both branches end with staff
 * owning the outcome; neither creates a record for the student.
 */
async function submitJoinForm(
  page: Page,
  names: { first: string; last: string },
  intent: "new" | "returning" = "returning",
) {
  await searchJoinName(page, names);

  const confirm = page
    .getByRole("button", { name: "Yes, this is me", exact: true })
    .first();
  const noProfile = page.getByRole("heading", {
    name: "We couldn’t find your profile",
  });
  await expect(confirm.or(noProfile)).toBeVisible();
  if (await confirm.isVisible()) {
    await confirm.click();
    return;
  }
  await declareMemberIntent(page, intent);
}

/** Clicks one of the two choices on "We couldn't find your profile". */
async function declareMemberIntent(page: Page, intent: "new" | "returning") {
  const label =
    intent === "new" ? "I’m a new member" : "I’m a returning member";
  await page.getByRole("button", { name: label, exact: true }).click();
}

/**
 * How many roster records a class code has ever minted in this organization.
 *
 * The local database carries fictional profiles created by earlier runs, back
 * when a class code did create a record. Those are real history and are left
 * alone, so this is a baseline to compare against rather than a number that
 * should be zero.
 */
async function countClassCodeCreatedProfiles(fixture: JoinFixture) {
  const { count } = await fixture.admin
    .schema("plugin_data")
    .from("csf_profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", fixture.organizationId)
    .eq("source_summary->>createdBy", "permanent_class_code");
  return count ?? 0;
}

/**
 * Every outcome of the join flow is a staff decision. Asserts the student got
 * a queued request and no self-made record, whichever branch they took.
 *
 * Pass `baselineClassCodeProfiles` from before the operation: the claim is
 * that this student created nothing, not that nobody ever did.
 */
async function expectQueuedForStaff(
  fixture: JoinFixture,
  expected: {
    memberIntent?: "new" | "returning";
    baselineClassCodeProfiles?: number;
  } = {},
) {
  await expect
    .poll(async () => {
      const [{ data: request }, { data: accounts }] = await Promise.all([
        fixture.admin
          .schema("plugin_data")
          .from("csf_profile_link_requests")
          .select("match_status,matched_profile_id,submitted_returning_status")
          .eq("organization_id", fixture.organizationId)
          .eq("user_id", fixture.userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        fixture.admin
          .schema("plugin_data")
          .from("csf_profile_accounts")
          .select("id")
          .eq("organization_id", fixture.organizationId)
          .eq("user_id", fixture.userId),
      ]);
      return {
        matchStatus: request?.match_status ?? null,
        matchedProfileId: request?.matched_profile_id ?? null,
        memberIntent: request?.submitted_returning_status ?? null,
        accountRows: accounts?.length ?? 0,
      };
    })
    .toEqual({
      matchStatus: "needs_review",
      matchedProfileId: null,
      memberIntent: expected.memberIntent ?? "returning",
      accountRows: 0,
    });

  // The decisive one, and it is scoped to this actor: a record this student
  // minted for themselves would carry their own user id as its owner. Exact,
  // and unaffected by whatever earlier runs left behind.
  const { count: selfMade } = await fixture.admin
    .schema("plugin_data")
    .from("csf_profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", fixture.organizationId)
    .eq("source_summary->>accountOwnerUserId", fixture.userId);
  expect(selfMade ?? 0).toBe(0);

  // And nothing new appeared under any actor while this ran.
  if (expected.baselineClassCodeProfiles !== undefined) {
    expect(await countClassCodeCreatedProfiles(fixture)).toBe(
      expected.baselineClassCodeProfiles,
    );
  }
}

test.describe("class join code connections", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: JoinFixture;
  let profileId: string;
  let ambiguousProfileIds: string[] = [];

  test.beforeAll(async () => {
    fixture = await loadJoinFixture();
  });

  test.afterAll(async () => {
    if (fixture) await cleanJoinFixture(fixture);
  });

  test("a contact-only email match requests review without claiming history", async ({
    page,
  }) => {
    await cleanJoinFixture(fixture);
    profileId = await seedProfileWithOutsiderEmail(fixture, {
      first: "Taylor",
      last: "Fixture",
    });

    const failures = watchBrowserFailures(page);
    await loginAs(page, "outsider", connectPath);

    await expect(
      page.getByRole("heading", { name: "Join your class" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeVisible();

    // Nothing about the roster record is previewed before the student
    // submits: neither the seeded name, the internal profile identifier, nor
    // the matched email may reach the rendered document.
    const preSubmitHtml = await page.content();
    expect(preSubmitHtml).not.toContain("Taylor Fixture");
    expect(preSubmitHtml).not.toContain(profileId);
    expect(preSubmitHtml).not.toContain(localActors.outsider.email);

    // Even control of the reported email does not prove ownership of the record.
    await submitJoinForm(page, { first: "Riley", last: "Mismatch" });

    await expect
      .poll(async () => {
        const [{ data: member }, { data: account }, { data: request }] =
          await Promise.all([
            fixture.admin
              .from("organization_members")
              .select("role,status")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .maybeSingle(),
            fixture.admin
              .schema("plugin_data")
              .from("csf_profile_accounts")
              .select("status,is_primary")
              .eq("organization_id", fixture.organizationId)
              .eq("profile_id", profileId)
              .eq("user_id", fixture.userId)
              .eq("status", "verified")
              .maybeSingle(),
            fixture.admin
              .schema("plugin_data")
              .from("csf_profile_link_requests")
              .select("match_status,matched_profile_id,candidate_profile_ids")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);
        return { member, account, request };
      })
      .toEqual({
        member: { role: "member", status: "active" },
        account: null,
        request: {
          candidate_profile_ids: [profileId],
          match_status: "needs_review",
          matched_profile_id: null,
        },
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", {
        name: "Awaiting staff review",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Go to My CSF" }),
    ).toHaveCount(0);
    expect(await page.content()).not.toContain(
      "Taylor Fixture's record is ready",
    );

    expectNoBrowserFailures(failures);
  });

  test("confirming a name-only match reaches an officer and never claims the record", async ({
    page,
  }) => {
    await cleanJoinFixture(fixture);
    const noEmailProfileId = await seedProfileWithoutEmail(
      fixture,
      fixture.accountName,
    );

    const failures = watchBrowserFailures(page);
    await loginAs(page, "outsider", connectPath);

    await expect(
      page.getByRole("heading", { name: "Is this you?", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(fixture.accountName.full, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Class of 2028", { exact: true }).first(),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Yes, this is me", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Awaiting staff review",
        exact: true,
      }),
    ).toBeVisible();

    // This record carries no curated contact, so the typed name is the only
    // evidence and a name is not ownership. No account row is created at all
    // and the request waits for an officer.
    await expect
      .poll(async () => {
        const [{ data: member }, { data: account }, { data: request }] =
          await Promise.all([
            fixture.admin
              .from("organization_members")
              .select("role,status")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .maybeSingle(),
            fixture.admin
              .schema("plugin_data")
              .from("csf_profile_accounts")
              .select("status,is_primary,connection_basis")
              .eq("organization_id", fixture.organizationId)
              .eq("profile_id", noEmailProfileId)
              .eq("user_id", fixture.userId)
              .maybeSingle(),
            fixture.admin
              .schema("plugin_data")
              .from("csf_profile_link_requests")
              .select("match_status,matched_profile_id,candidate_profile_ids")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);
        return { account, member, request };
      })
      .toEqual({
        account: null,
        member: { role: "member", status: "active" },
        request: {
          candidate_profile_ids: [noEmailProfileId],
          match_status: "needs_review",
          matched_profile_id: null,
        },
      });

    // A reload replays the same waiting answer rather than offering the
    // confirm button again.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", {
        name: "Awaiting staff review",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Yes, this is me", exact: true }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("a shortened first name finds the record but still needs an officer", async ({
    page,
  }) => {
    await cleanJoinFixture(fixture);
    // The roster says Saisampath; the student types Sai. Three letters on an
    // exact last name is the tolerance the database allows.
    const lastName = `Uppu-${runToken}`;
    const longFirstProfileId = await seedProfileWithoutEmail(fixture, {
      first: "Saisampath",
      last: lastName,
    });

    const failures = watchBrowserFailures(page);
    await loginAs(page, "outsider", connectPath);
    await expect(
      page.getByRole("heading", { name: "Join your class" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Join your class" });
    await expect(dialog).toBeVisible();
    const fullName = dialog.getByRole("textbox", { name: "Full name" });
    await expect(fullName).toBeVisible();
    await fullName.fill(`Sai ${lastName}`);
    await dialog.getByRole("button", { name: "Find my record" }).click();

    // The record is shown with how it matched, and the copy is honest about
    // what decides, before the student clicks anything.
    const found = page.getByRole("dialog", { name: "Is this you?" });
    await expect(found).toBeVisible();
    await expect(
      found.getByText(`Saisampath ${lastName}`, { exact: true }),
    ).toBeVisible();
    await expect(found.getByText("Starts the same way")).toBeVisible();
    await expect(
      found.getByText(/otherwise a CSF officer checks it first/),
    ).toBeVisible();
    await found
      .getByRole("button", { name: "Yes, this is me", exact: true })
      .click();

    await expect(
      page.getByRole("heading", {
        name: "Awaiting staff review",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const { data: account } = await fixture.admin
          .schema("plugin_data")
          .from("csf_profile_accounts")
          .select("status,connection_basis")
          .eq("organization_id", fixture.organizationId)
          .eq("profile_id", longFirstProfileId)
          .eq("user_id", fixture.userId)
          .maybeSingle();
        return account;
      })
      .toEqual(null);

    expectNoBrowserFailures(failures);
  });

  test("ambiguous email evidence queues for officer review without linking", async ({
    page,
  }) => {
    await cleanJoinFixture(fixture);
    // Two active class records share the account's verified email, so no
    // automatic match is possible and the request must fail closed.
    ambiguousProfileIds = [
      await seedProfileWithOutsiderEmail(fixture, {
        first: "Rowan",
        last: reviewLastName,
      }),
      await seedProfileWithOutsiderEmail(fixture, {
        first: "Rowan",
        last: reviewLastName,
      }),
    ].sort();

    const failures = watchBrowserFailures(page);
    await loginAs(page, "outsider", connectPath);
    await expect(
      page.getByRole("heading", { name: "Join your class" }),
    ).toBeVisible();

    await submitJoinForm(page, { first: "Rowan", last: reviewLastName });

    await expect
      .poll(async () => {
        const [{ data: member }, { data: accounts }, { data: request }] =
          await Promise.all([
            fixture.admin
              .from("organization_members")
              .select("role,status")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .maybeSingle(),
            fixture.admin
              .schema("plugin_data")
              .from("csf_profile_accounts")
              .select("id")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .eq("status", "verified"),
            fixture.admin
              .schema("plugin_data")
              .from("csf_profile_link_requests")
              .select(
                "match_status,matched_profile_id,candidate_profile_ids,cohort_id",
              )
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);
        return { member, accounts, request };
      })
      .toEqual({
        member: { role: "member", status: "active" },
        accounts: [],
        request: {
          match_status: "needs_review",
          matched_profile_id: null,
          candidate_profile_ids: ambiguousProfileIds,
          cohort_id: fixture.cohortId,
        },
      });

    expectNoBrowserFailures(failures);
  });

  test("a mistyped name can be corrected, and an unmatched student declares new or returning", async ({
    page,
  }) => {
    await cleanJoinFixture(fixture);
    const realLastName = `Rana-${runToken}`;
    await seedProfileWithoutEmail(fixture, {
      first: "Riddhiman",
      last: realLastName,
    });
    // Fictional profiles from earlier runs, made when a class code still
    // created one, stay exactly where they are. The claim is a delta.
    const classCodeProfilesBefore =
      await countClassCodeCreatedProfiles(fixture);

    const failures = watchBrowserFailures(page);
    await loginAs(page, "outsider", connectPath);
    await expect(
      page.getByRole("heading", { name: "Join your class" }),
    ).toBeVisible();

    // A typo finds nothing. This is the trap: before the fix there was no
    // control back to the field, and closing the dialog kept the dead answer.
    await searchJoinName(page, {
      first: "Riddhiman",
      last: `${realLastName}-typo`,
    });
    await expect(
      page.getByRole("heading", { name: "We couldn’t find your profile" }),
    ).toBeVisible();

    // Closing and reopening must not replay the stale result.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Join your class" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "We couldn’t find your profile" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // And the in-place correction reaches a real match.
    await searchJoinName(page, {
      first: "Riddhiman",
      last: `${realLastName}-typo`,
    });
    await page
      .getByRole("button", {
        name: "Check the spelling and search again",
        exact: true,
      })
      .click();
    const retryField = page
      .getByRole("dialog", { name: "Join your class" })
      .getByRole("textbox", { name: "Full name" });
    await expect(retryField).toBeVisible();
    await retryField.fill(`Riddhiman ${realLastName}`);
    await page.getByRole("button", { name: "Find my record" }).click();
    await expect(
      page.getByRole("heading", { name: "Is this you?", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`Riddhiman ${realLastName}`, { exact: true }),
    ).toBeVisible();

    // The student says none of these is them, and declares they are new.
    await page
      .getByRole("button", { name: "None of these is me", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "We couldn’t find your profile" }),
    ).toBeVisible();
    await declareMemberIntent(page, "new");

    // The declared intent, the class, and the account reach the staff queue,
    // and nothing was created on the student's say-so.
    await expectQueuedForStaff(fixture, {
      memberIntent: "new",
      baselineClassCodeProfiles: classCodeProfilesBefore,
    });

    await expect(
      page.getByRole("heading", { name: "Awaiting staff review", exact: true }),
    ).toBeVisible();

    // The status survives arriving without the code in the URL, which is the
    // path "Open My CSF" and a bookmark both take.
    await page.goto(noCodeConnectPath, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Awaiting staff review", exact: true }),
    ).toBeVisible();

    expectNoBrowserFailures(failures);
  });

  test("an officer rejects the queued request from the class Members tab", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin", cohortMembersPath(fixture.cohortId));

    const reviewQueue = page.locator("details").filter({
      has: page.locator("summary").filter({ hasText: "Accounts to connect" }),
    });
    await expect(reviewQueue).toBeVisible();
    await expect(reviewQueue).not.toHaveAttribute("open", "");
    await reviewQueue.locator("summary").click();
    const resolveButton = reviewQueue.getByRole("button", {
      name: "Review",
      exact: true,
    });
    await expect(resolveButton).toBeVisible();
    await resolveButton.click();

    const resolveDialog = page.getByRole("dialog", {
      name: "Review account connection",
    });
    await expect(resolveDialog).toBeVisible();
    // Without canonical identity evidence the one-click connect is not merely
    // disabled: it is not offered at all.
    await expect(
      resolveDialog.getByRole("button", { name: "Connect account" }),
    ).toHaveCount(0);
    await resolveDialog
      .getByLabel("Decision reason")
      .fill("Two roster records share this email; rejecting for follow-up.");
    await resolveDialog.getByRole("button", { name: "Reject request" }).click();
    await expect(resolveDialog).toBeHidden();

    await expect
      .poll(async () => {
        const [{ data: request }, { data: accounts }, { data: member }] =
          await Promise.all([
            fixture.admin
              .schema("plugin_data")
              .from("csf_profile_link_requests")
              .select("match_status")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            fixture.admin
              .schema("plugin_data")
              .from("csf_profile_accounts")
              .select("id")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .eq("status", "verified"),
            fixture.admin
              .from("organization_members")
              .select("role,status")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .maybeSingle(),
          ]);
        return {
          matchStatus: request?.match_status ?? null,
          accounts,
          member,
        };
      })
      .toEqual({
        matchStatus: "rejected",
        accounts: [],
        member: { role: "member", status: "active" },
      });

    // A settled request leaves the queue and the connection guide stays visible.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      reviewQueue.getByText(
        "No accounts are waiting. Students can sign in and use the class join code to request a connection.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      reviewQueue.getByRole("button", { name: "Reject", exact: true }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });
});

test.describe("signed-out CSF connection states", () => {
  test("the no-code page accepts a permanent class join code", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.goto(noCodeConnectPath, { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Join a class" }),
    ).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).toContain("six-character code");
    expect(body).toContain("officer shared with you");
    expectNoPrivateBoundaryMarkers(body);

    // Only code entry exists until a valid class code resolves.
    await expect(page.locator("main form")).toHaveCount(1);
    await expect(page.getByLabel("Join code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    const joinCode = page.getByLabel("Join code");
    await expect(joinCode).toHaveAttribute("inputmode", "text");
    await joinCode.pressSequentially("A");
    await expect(joinCode).toHaveValue("A");
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await joinCode.pressSequentially("2B3C4");
    await expect(joinCode).toHaveValue("A2B3C4");
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await expect(
      page.getByRole("dialog", { name: "Join your class", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Yes, this is me/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Sign in to continue" }),
    ).toHaveCount(0);

    const returnLink = await soleAccessibleAction(page, "Back to the CSF page");
    await expect(returnLink).toHaveAttribute("href", CSF_PUBLIC_PATH);

    // Signing in is offered separately from joining, and it returns to the
    // canonical organization route rather than to this page.
    const signIn = await soleAccessibleAction(page, "Sign in to My CSF");
    await expect(signIn).toHaveAttribute(
      "href",
      `/login?redirect=${encodeURIComponent(`${CSF_ORGANIZATION_PATH}?tab=csf-profile`)}`,
    );

    await expect(
      page.getByRole("navigation", { name: "DVHS CSF workspace" }),
    ).toHaveCount(0);
    expectNoBrowserFailures(failures);
  });

  test("an unusable class code is reported honestly and is never carried through login", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.goto(unusableConnectPath, { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "That class code didn’t work" }),
    ).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).toContain("Check all six characters and try again.");
    expectNoPrivateBoundaryMarkers(body);

    // No join form, and no sign-in tied to the unusable code.
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(
      page.locator("main").getByRole("button", { name: /Sign in/ }),
    ).toHaveCount(0);

    const hrefs = await page
      .locator("main a")
      .evaluateAll((links) =>
        links.map(
          (link) => (link as HTMLAnchorElement).getAttribute("href") ?? "",
        ),
      );
    expect(hrefs.some((href) => href.includes("ZZZZZ9"))).toBe(false);
    expect(hrefs.some((href) => href.includes("/login"))).toBe(false);

    const returnLink = await soleAccessibleAction(page, "Back to the CSF page");
    await expect(returnLink).toHaveAttribute("href", CSF_PUBLIC_PATH);

    expectNoBrowserFailures(failures);
  });

  test("a valid class code shows safe context and preserves its route through sign in", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.goto(connectPath, { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Sign in to continue" }),
    ).toBeVisible();
    const body = await page.locator("body").innerText();
    // Safe class context only: the lasting class selected by the code.
    expect(body).toContain("Class of 2028");
    expectNoPrivateBoundaryMarkers(body);
    // The code itself is never rendered back to the visitor.
    expect(body).not.toContain(classJoinCode);

    const signIn = await soleAccessibleAction(page, "Sign in");
    await expect(signIn).toHaveAttribute(
      "href",
      `/login?redirect=${encodeURIComponent(connectPath)}`,
    );

    // A signed-out visitor sees no join form and no connected-profile
    // affordances.
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Join your class", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Yes, this is me/ }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });
});
