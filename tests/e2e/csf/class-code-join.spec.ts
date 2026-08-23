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
 * submits the join form; `csf_join_class_by_code` matches on the account's
 * verified email only. One exact in-class match auto-connects; conflicting or
 * ambiguous email evidence lands as `needs_review` in that class's Members
 * tab "Needs attention" queue, where an officer resolves it.
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
    organizationId: organization.id,
    cohortId: cohort.id,
    retirementTargetProfileId: retirementTarget.id,
    userId: user.id,
  };
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

  const { error: accountError } = await plugin
    .from("csf_profile_accounts")
    .update({
      status: "revoked",
      is_primary: false,
      revoked_at: new Date().toISOString(),
      notes: "Retired synthetic browser class-code join fixture.",
    })
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

/** Opens the join dialog and submits the profile-details form. */
async function submitJoinForm(
  page: Page,
  names: { first: string; last: string },
) {
  await page
    .getByRole("button", { name: "Add profile details", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Find your CSF record" });
  await expect(dialog).toBeVisible();
  // The name fields prefill asynchronously from the signed-in account and
  // remount when the prefill arrives; the flow does not depend on which value
  // wins because `csf_join_class_by_code` matches on verified email only.
  await dialog.getByLabel("First name").fill(names.first);
  await dialog.getByLabel("Last name").fill(names.last);
  await dialog.getByRole("button", { name: "Find my record" }).click();
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

  test("one exact verified-email match in the class auto-connects", async ({
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
      page.getByRole("heading", { name: "Connect your CSF record" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add profile details", exact: true }),
    ).toBeVisible();

    // Nothing about the roster record is previewed before the student
    // submits: neither the seeded name, the internal profile identifier, nor
    // the matched email may reach the rendered document.
    const preSubmitHtml = await page.content();
    expect(preSubmitHtml).not.toContain("Taylor Fixture");
    expect(preSubmitHtml).not.toContain(profileId);
    expect(preSubmitHtml).not.toContain(localActors.outsider.email);

    // The student's typed name deliberately mismatches the roster record:
    // the verified account email is the only automatic matching signal.
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
              .select("match_status,matched_profile_id")
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
        account: { status: "verified", is_primary: true },
        request: {
          match_status: "auto_linked",
          matched_profile_id: profileId,
        },
      });

    // The re-rendered page reports the connected record instead of the form.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("main").getByText("Taylor Fixture", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use this profile" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add profile details", exact: true }),
    ).toHaveCount(0);

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
      page.getByRole("heading", { name: "Connect your CSF record" }),
    ).toBeVisible();

    await submitJoinForm(page, { first: "Rowan", last: reviewLastName });

    await expect
      .poll(async () => {
        const [{ data: member }, { data: accounts }, { data: request }] =
          await Promise.all([
            fixture.admin
              .from("organization_members")
              .select("id")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId)
              .maybeSingle(),
            fixture.admin
              .schema("plugin_data")
              .from("csf_profile_accounts")
              .select("id")
              .eq("organization_id", fixture.organizationId)
              .eq("user_id", fixture.userId),
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
        member: null,
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

  test("an officer rejects the queued request from the class Members tab", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin", cohortMembersPath(fixture.cohortId));

    const reviewQueue = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Needs attention", exact: true }),
    });
    await expect(reviewQueue).toBeVisible();
    await expect(
      reviewQueue.getByText("Class-code joins waiting for an officer decision"),
    ).toBeVisible();

    const requestName = `Rowan ${reviewLastName}`;
    const requestCard = reviewQueue
      .getByText(requestName, { exact: true })
      .first()
      .locator("..")
      .locator("..");
    await expect(requestCard).toBeVisible();
    await requestCard
      .getByRole("button", { name: "Resolve", exact: true })
      .click();

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
              .eq("user_id", fixture.userId),
            fixture.admin
              .from("organization_members")
              .select("id")
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
      .toEqual({ matchStatus: "rejected", accounts: [], member: null });

    // A settled request leaves the queue; with nothing pending the section
    // does not render at all. (The seeded roster records legitimately remain
    // in the member directory, so the assertion is scoped to the queue.)
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(reviewQueue).toHaveCount(0);

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
      page.getByRole("heading", { name: "Join or connect to CSF" }),
    ).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).toContain("permanent code");
    expect(body).toContain("verified email");
    expectNoPrivateBoundaryMarkers(body);

    // Only code entry exists until a valid class code resolves.
    await expect(page.locator("main form")).toHaveCount(1);
    await expect(page.getByLabel("Class join code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Find my record/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Add profile details/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Use this profile/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Sign in to claim profile/ }),
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
      page.getByRole("heading", {
        name: "This class join code is unavailable",
      }),
    ).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).toContain("mistyped, disabled, or replaced");
    expect(body).toContain(
      "Ask a CSF officer for the current join code for your class",
    );
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
      page.getByRole("heading", { name: "Connect your CSF record" }),
    ).toBeVisible();
    const body = await page.locator("body").innerText();
    // Safe class context only: the lasting class, and the reminder that
    // semester participation is approved separately.
    expect(body).toContain("Class of 2028");
    expect(body).toContain(
      "Participation is approved separately each semester",
    );
    expectNoPrivateBoundaryMarkers(body);
    // The code itself is never rendered back to the visitor.
    expect(body).not.toContain(classJoinCode);

    const signIn = await soleAccessibleAction(page, "Sign in to claim profile");
    await expect(signIn).toHaveAttribute(
      "href",
      `/login?redirect=${encodeURIComponent(connectPath)}`,
    );

    // A signed-out visitor sees no join form and no connected-profile
    // affordances.
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Add profile details/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Use this profile/ }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });
});
