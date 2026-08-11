import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { CSF_ORGANIZATION_PATH } from "./helpers";

/**
 * The full cohort-link signup seam, end to end with fictional data only:
 * class invitation -> account signup (metadata seam) -> admin email
 * confirmation (the local stack requires confirmed email, and the browser
 * suite never reads real mail) -> login back into the invitation -> claim
 * confirm -> `?connected=1` -> the CSF-variant username modal on the connect
 * route -> the member Home CSF setup tour. The generic 8-step FirstLoginTour
 * must never render for this account.
 */

const onboardingCode = "S26-2028";
const connectPath = `${CSF_ORGANIZATION_PATH}/plugins/dvhs-csf/connect/${onboardingCode}`;

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

async function seedClaimProfile(fixture: SignupFixture) {
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
    throw new Error(
      `Could not seed the claim profile: ${profileError.message}`,
    );
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
        `Could not clean claim requests: ${requestsError.message}`,
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
        `Could not retire claim accounts: ${accountError.message}`,
      );
    }
  }

  // Confirmed claims are referenced by immutable audit rows, so browser
  // fixtures are de-identified rather than deleted (same contract as
  // profile-claim.spec.ts). The merger is recorded as the persistent
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
      `Could not retire the claim profile: ${profileError.message}`,
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

test.describe("cohort-link signup onboarding", () => {
  test.describe.configure({ mode: "serial" });

  let fixture: SignupFixture;
  let createdUserId: string | null = null;

  test.beforeAll(async () => {
    fixture = await loadSignupFixture();
  });

  test.afterAll(async () => {
    if (!fixture) return;
    const user = await findUserIdByEmail(fixture, signupEmail);
    await cleanSignupFixture(fixture, user?.id ?? createdUserId);
  });

  test("cohort link signup carries the CSF metadata seam and finishes on the connect route", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await test.step("sign up from the class invitation redirect", async () => {
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

      await seedClaimProfile(fixture);
    });

    await test.step("log in back into the invitation and confirm the record", async () => {
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
        page.getByRole("heading", {
          name: "We found your CSF record — is this you?",
        }),
      ).toBeVisible();
      await expectNoGenericFirstLoginTour(page);
      await page
        .getByRole("button", { name: "Yes, connect this record" })
        .click();

      await expect
        .poll(async () => {
          const { data } = await fixture.admin
            .schema("plugin_data")
            .from("csf_profile_accounts")
            .select("status")
            .eq("organization_id", fixture.organizationId)
            .eq("user_id", createdUserId as string)
            .eq("status", "verified")
            .maybeSingle();
          return data?.status ?? null;
        })
        .toBe("verified");
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
