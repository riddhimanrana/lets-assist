import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { CSF_ORGANIZATION_PATH } from "./helpers";

/**
 * The full class-code signup seam, end to end with fictional data only:
 * the permanent class join code page -> account signup (metadata seam) ->
 * admin email confirmation (the local stack requires confirmed email, and the
 * browser suite never reads real mail) -> login back into the join code
 * route -> the join form -> the verified-email auto-connect ->
 * `?connected=1` -> the CSF-variant username modal on the connect route ->
 * the member Home CSF setup tour. The generic 8-step FirstLoginTour must
 * never render for this account.
 */

const classJoinCode = "HAWK28";
const connectPath = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/connect/${classJoinCode}`;

const runToken = Date.now().toString(36);
const signupEmail = `csf.e2e.signup.${runToken}@local.test`;
const signupPassword = `E2eSignup9${runToken}A`;
const signupFullName = "Casey Signup Fixture";
const signupUsername = `e2ecsf${runToken}`.slice(0, 20);

type SignupFixture = {
  admin: SupabaseClient;
  organizationId: string;
  cohortId: string;
  retirementTargetProfileId: string;
  /** Persistent fixture actor recorded as the merger during cleanup. */
  developerUserId: string;
};

async function loadSignupFixture(): Promise<SignupFixture> {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("username", "dvhs-csf")
    .single();
  if (organizationError || !organization) {
    throw new Error(
      `Could not load the local DVHS CSF organization: ${organizationError?.message ?? "missing fixture"}`,
    );
  }

  const plugin = admin.schema("plugin_data");
  const [{ data: cohort, error: cohortError }, retirementResult] =
    await Promise.all([
      plugin
        .from("csf_cohorts")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("graduation_year", 2028)
        .single(),
      plugin
        .from("csf_profiles")
        .select("id")
        .eq("organization_id", organization.id)
        .eq("normalized_school_email", "nina.kapoor28@students.local.test")
        .single(),
    ]);
  if (cohortError || !cohort) {
    throw new Error(
      `Could not load the Class of 2028 fixture: ${cohortError?.message ?? "missing fixture"}`,
    );
  }
  if (retirementResult.error || !retirementResult.data) {
    throw new Error(
      `Could not load the fixture retirement target: ${retirementResult.error?.message ?? "missing fixture"}`,
    );
  }

  const usersResult = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (usersResult.error) {
    throw new Error(
      `Could not load local auth fixtures: ${usersResult.error.message}`,
    );
  }
  const developer = usersResult.data.users.find(
    (candidate) => candidate.email === "platform.admin@local.test",
  );
  if (!developer) {
    throw new Error("The local developer auth fixture is missing.");
  }

  return {
    admin,
    organizationId: organization.id,
    cohortId: cohort.id,
    retirementTargetProfileId: retirementResult.data.id,
    developerUserId: developer.id,
  };
}

async function findUserIdByEmail(fixture: SignupFixture, email: string) {
  const usersResult = await fixture.admin.auth.admin.listUsers({
    page: 1,
    perPage: 1_000,
  });
  if (usersResult.error) {
    throw new Error(`Could not list local users: ${usersResult.error.message}`);
  }
  return (
    usersResult.data.users.find((candidate) => candidate.email === email) ??
    null
  );
}

/**
 * The roster record the join form's verified-email match auto-connects: it
 * carries the synthetic account's email and an active Class of 2028
 * membership, so `csf_join_class_by_code` finds exactly one candidate.
 */
async function seedJoinProfile(fixture: SignupFixture) {
  const plugin = fixture.admin.schema("plugin_data");
  const profileId = randomUUID();

  const { error: profileError } = await plugin.from("csf_profiles").insert({
    id: profileId,
    organization_id: fixture.organizationId,
    first_name: "Casey",
    last_name: "Signup",
    preferred_name: "Casey",
    personal_email: signupEmail,
    normalized_first_name: "casey",
    normalized_last_name: "signup",
    normalized_personal_email: signupEmail,
    source_summary: { e2eSignupFixture: true },
  });
  if (profileError) {
    throw new Error(`Could not seed the join profile: ${profileError.message}`);
  }

  const { error: membershipError } = await plugin
    .from("csf_profile_cohort_memberships")
    .insert({
      organization_id: fixture.organizationId,
      profile_id: profileId,
      cohort_id: fixture.cohortId,
      status: "active",
    });
  if (membershipError) {
    throw new Error(
      `Could not seed the cohort membership: ${membershipError.message}`,
    );
  }

  return profileId;
}

async function cleanSignupFixture(
  fixture: SignupFixture,
  userId: string | null,
) {
  const plugin = fixture.admin.schema("plugin_data");

  if (userId) {
    const { error: requestsError } = await plugin
      .from("csf_profile_link_requests")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", userId);
    if (requestsError) {
      throw new Error(
        `Could not clean join requests: ${requestsError.message}`,
      );
    }

    const { error: membershipError } = await fixture.admin
      .from("organization_members")
      .delete()
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", userId);
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
        notes: "Retired synthetic signup-onboarding fixture.",
      })
      .eq("organization_id", fixture.organizationId)
      .eq("user_id", userId);
    if (accountError) {
      throw new Error(
        `Could not retire join accounts: ${accountError.message}`,
      );
    }
  }

  // Connected joins are referenced by immutable audit rows, so browser
  // fixtures are de-identified rather than deleted (same contract as
  // class-code-join.spec.ts). The merger is recorded as the persistent
  // developer fixture: `merged_by` has an ON DELETE RESTRICT FK to
  // auth.users, and the synthetic signup user is deleted below.
  const { error: profileError } = await plugin
    .from("csf_profiles")
    .update({
      record_status: "merged",
      merged_into_profile_id: fixture.retirementTargetProfileId,
      merged_at: new Date().toISOString(),
      merged_by: fixture.developerUserId,
      merge_reason: "Retired synthetic signup-onboarding fixture.",
      personal_email: null,
      normalized_personal_email: null,
    })
    .eq("organization_id", fixture.organizationId)
    .eq("record_status", "active")
    .contains("source_summary", { e2eSignupFixture: true });
  if (profileError) {
    throw new Error(
      `Could not retire the join profile: ${profileError.message}`,
    );
  }

  if (userId) {
    const { error: deleteError } =
      await fixture.admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      throw new Error(
        `Could not delete the synthetic signup user: ${deleteError.message}`,
      );
    }
  }
}

async function expectNoGenericFirstLoginTour(page: Page) {
  await expect(page.locator("body[data-first-login-tour='true']")).toHaveCount(
    0,
  );
  await expect(page.getByText("Welcome to your hub")).toHaveCount(0);
}

test.describe("class-code signup onboarding", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: SignupFixture;
  let createdUserId: string | null = null;
  let seededProfileId: string | null = null;

  test.beforeAll(async () => {
    fixture = await loadSignupFixture();
  });

  test.afterAll(async () => {
    if (!fixture) return;
    const user = await findUserIdByEmail(fixture, signupEmail);
    await cleanSignupFixture(fixture, user?.id ?? createdUserId);
  });

  test("class-code signup carries the CSF metadata seam and finishes on the connect route", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await test.step("the signed-out code page shows safe class context and preserves the route", async () => {
      await page.goto(connectPath, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "Connect your CSF record" }),
      ).toBeVisible();
      const body = await page.locator("body").innerText();
      expect(body).toContain("Class of 2028");
      expect(body).toContain(
        "Participation is approved separately each semester",
      );

      // Sign-in keeps the full connect route, so the account created next can
      // come straight back to this page.
      const signIn = page.getByRole("button", {
        name: "Sign in to claim profile",
        exact: true,
      });
      await expect(signIn).toHaveAttribute(
        "href",
        `/login?redirect=${encodeURIComponent(connectPath)}`,
      );
    });

    await test.step("sign up from the class-code redirect", async () => {
      await page.goto(`/signup?redirect=${encodeURIComponent(connectPath)}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByText("Secure check ready", { exact: true }).first(),
      ).toBeVisible();
      // Hydration can briefly leave a duplicate copy of the card in the
      // document; wait for the settled single form, then prove the controlled
      // inputs kept their values before submitting (the login helper guards
      // the same race with its hydration marker).
      const fullName = page.locator("#fullName");
      const email = page.locator("#email");
      const password = page.locator("#password");
      await expect(fullName).toHaveCount(1, { timeout: 20_000 });
      await fullName.fill(signupFullName);
      await email.fill(signupEmail);
      await password.fill(signupPassword);
      await expect(fullName).toHaveValue(signupFullName);
      await expect(email).toHaveValue(signupEmail);
      await expect(password).toHaveValue(signupPassword);
      const submit = page.getByRole("button", { name: "Create Account" });
      await expect(submit).toBeEnabled();
      await submit.click();
      await page.waitForURL(/\/signup\/success/, {
        waitUntil: "domcontentloaded",
      });
    });

    await test.step("the account carries the csf_connect signup seam", async () => {
      await expect
        .poll(async () => {
          const user = await findUserIdByEmail(fixture, signupEmail);
          if (!user) return null;
          createdUserId = user.id;
          const metadata = (user.user_metadata ?? {}) as Record<
            string,
            unknown
          >;
          return {
            signupFlow: metadata.signup_flow ?? null,
            introTourDone: metadata.has_completed_intro_tour ?? null,
          };
        })
        .toEqual({ signupFlow: "csf_connect", introTourDone: true });

      // The isolated stack requires confirmed email; the suite confirms it
      // through the local admin API instead of reading mail.
      const { error } = await fixture.admin.auth.admin.updateUserById(
        createdUserId as string,
        { email_confirm: true },
      );
      if (error) {
        throw new Error(`Could not confirm the signup email: ${error.message}`);
      }

      seededProfileId = await seedJoinProfile(fixture);
    });

    await test.step("log in back into the code page and submit the join form", async () => {
      await page.goto(`/login?redirect=${encodeURIComponent(connectPath)}`, {
        waitUntil: "domcontentloaded",
      });
      const main = page.getByRole("main");
      await expect(main.locator('form[data-hydrated="true"]')).toBeVisible();
      await expect(
        main.getByText("Secure check ready", { exact: true }),
      ).toBeVisible();
      await main.getByRole("textbox", { name: "Email" }).fill(signupEmail);
      await main.getByLabel("Password").fill(signupPassword);
      await main.getByRole("button", { name: "Login", exact: true }).click();
      await page.waitForURL((url) => url.pathname === connectPath, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      await expect(
        page.getByRole("heading", { name: "Connect your CSF record" }),
      ).toBeVisible();
      await expectNoGenericFirstLoginTour(page);

      await page
        .getByRole("button", { name: "Add profile details", exact: true })
        .click();
      const joinDialog = page.getByRole("dialog", {
        name: "Find your CSF record",
      });
      await expect(joinDialog).toBeVisible();
      // The name fields prefill asynchronously from the account's full name
      // and remount when the prefill arrives; the auto-connect decision rests
      // on the verified account email, not on the typed name, so the flow is
      // deterministic either way.
      await joinDialog.getByLabel("First name").fill("Casey");
      await joinDialog.getByLabel("Last name").fill("Signup");
      await joinDialog.getByRole("button", { name: "Find my record" }).click();

      await expect
        .poll(async () => {
          const { data } = await fixture.admin
            .schema("plugin_data")
            .from("csf_profile_accounts")
            .select("status,profile_id")
            .eq("organization_id", fixture.organizationId)
            .eq("user_id", createdUserId as string)
            .eq("status", "verified")
            .maybeSingle();
          return data
            ? { status: data.status, profileId: data.profile_id }
            : null;
        })
        .toEqual({ status: "verified", profileId: seededProfileId });
    });

    await test.step("the connect route gains ?connected=1 and the CSF username modal", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForURL(
        (url) =>
          url.pathname === connectPath &&
          url.searchParams.get("connected") === "1",
        { timeout: 30_000 },
      );

      const modal = page.getByRole("dialog");
      await expect(
        modal.getByText("Finish setting up your Let's Assist account"),
      ).toBeVisible();
      await expect(
        modal.getByText(
          "Your CSF record is connected — choose a username to finish",
        ),
      ).toBeVisible();

      const usernameInput = modal.getByLabel("Choose your username");
      await usernameInput.fill(signupUsername);
      await usernameInput.blur();
      const getStarted = modal.getByRole("button", { name: "Get Started" });
      await expect(getStarted).toBeEnabled({ timeout: 20_000 });
      await getStarted.click();

      await page.waitForURL(
        (url) =>
          url.pathname === connectPath &&
          url.searchParams.get("onboarding") === "complete",
        { timeout: 60_000 },
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expectNoGenericFirstLoginTour(page);
    });

    await test.step("member Feed runs the CSF setup tour, never the generic tour", async () => {
      await page.goto(CSF_ORGANIZATION_PATH, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("tab", { name: "Feed", exact: true }),
      ).toBeVisible();

      const tourCard = page
        .locator('[data-slot="card"]')
        .filter({ hasText: "Your class feed" })
        .first();
      await expect(tourCard).toBeVisible({ timeout: 20_000 });
      await tourCard.getByRole("button", { name: "Next", exact: true }).click();
      await expect(
        page.getByText("Points at a glance", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Skip tour", exact: true })
        .click();
      await expect(page.getByText("Points at a glance")).toHaveCount(0);
      await expectNoGenericFirstLoginTour(page);

      // The tour completes exactly once: metadata records it.
      await expect
        .poll(async () => {
          const user = await findUserIdByEmail(fixture, signupEmail);
          const metadata = (user?.user_metadata ?? {}) as Record<
            string,
            unknown
          >;
          return metadata.has_completed_csf_tour ?? null;
        })
        .toBe(true);
    });

    await test.step("/home never shows the generic FirstLoginTour", async () => {
      await page.goto("/home", { waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-tour-id='home-greeting']")).toBeVisible({
        timeout: 20_000,
      });
      // The tour arms itself up to 1.5s after the greeting renders; give it
      // more than that before asserting it never appeared.
      await page.waitForTimeout(2_500);
      await expectNoGenericFirstLoginTour(page);
    });
  });
});
