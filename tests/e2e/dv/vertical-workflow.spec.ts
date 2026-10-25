import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { getLocalSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";

const ORGANIZATION_ID = "d0000000-0000-4000-8000-000000000001";
const ORGANIZATION_SLUG = "dv-speech-debate";
const TOURNAMENT_ID = "d0000000-0000-4000-8000-000000000021";
const STUDENT_EMAIL = "dv.student.a@local.test";

function adminClient() {
  const env = getLocalSupabaseEnv();
  return createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

test("approved student can open the current seasonal membership workspace", async ({
  page,
}) => {
  const password = process.env.DV_LOCAL_TEST_PASSWORD;
  if (!password) {
    throw new Error(
      "Set DV_LOCAL_TEST_PASSWORD before running DV Playwright tests.",
    );
  }

  await page.goto(
    `/login?redirect=${encodeURIComponent(
      `/organization/${ORGANIZATION_SLUG}/plugins/dv-speech-debate`,
    )}`,
  );
  const main = page.getByRole("main");
  // The server-rendered form is intentionally inert until LoginClient hydrates.
  // Filling controlled fields before these markers are present can lose the
  // values or submit without the client auth handler on a slower CI compiler.
  await expect(main.locator('form[data-hydrated="true"]')).toBeVisible();
  await expect(
    main.getByText("Secure check ready", { exact: true }),
  ).toBeVisible();
  const email = main.getByRole("textbox", { name: "Email" });
  await email.fill(STUDENT_EMAIL);
  await main.getByLabel("Password").fill(password);
  await expect(email).toHaveValue(STUDENT_EMAIL);
  const expectedPath = `/organization/${ORGANIZATION_SLUG}/plugins/dv-speech-debate`;
  await main.getByRole("button", { name: "Login", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 60_000 })
    .toBe(expectedPath);
  await expect(
    page.getByRole("heading", { name: /DV Speech & Debate/i }).first(),
  ).toBeVisible();
  const membership = page.getByText("2026-2027 membership");
  // The first authenticated request cold-compiles the private plugin route.
  // Next's development HMR can replace that route's client-action chunks after
  // the shell is already visible. Reload only that proven shell once so the
  // workflow assertion runs against the completed compiler generation.
  const loadedWithoutRefresh = await membership
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!loadedWithoutRefresh) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(membership).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
});

test("guardian availability link is single-use and updates judge availability", async ({
  page,
}) => {
  const admin = adminClient();
  const plugin = admin.schema("plugin_data");
  const { data: judge, error: judgeError } = await plugin
    .from("dv_sd_judges")
    .select("id,guardian_id")
    .eq("organization_id", ORGANIZATION_ID)
    .single();
  expect(judgeError).toBeNull();
  expect(judge).toBeTruthy();

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { error: tokenError } = await plugin
    .from("dv_sd_guardian_action_tokens")
    .insert({
      organization_id: ORGANIZATION_ID,
      guardian_id: judge!.guardian_id,
      purpose: "confirm_availability",
      token_hash: tokenHash,
      payload: {
        tournamentId: TOURNAMENT_ID,
        judgeId: judge!.id,
        tournamentName: "Local Invitational",
      },
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
  expect(tokenError).toBeNull();

  await page.goto(`/guardian-action/${token}`);
  const actionCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Confirm judging availability" })
    .first();
  await expect(
    actionCard.getByText("Confirm judging availability"),
  ).toBeVisible();
  await expect(actionCard.locator('form[data-hydrated="true"]')).toBeVisible();
  const limitedAvailability = actionCard.getByRole("radio", {
    name: "Available for some rounds",
  });
  await limitedAvailability.click();
  await expect(limitedAvailability).toBeChecked();
  const notes = actionCard.getByLabel("Notes");
  await notes.fill("Available after the first round.");
  await expect(notes).toHaveValue("Available after the first round.");
  await actionCard
    .getByRole("button", { name: "Confirm availability" })
    .click();
  await expect(
    page.getByRole("alert").getByText("Availability recorded").first(),
  ).toBeVisible();

  const { data: availability, error: availabilityError } = await plugin
    .from("dv_sd_judge_availability")
    .select("status,notes,confirmed_at")
    .eq("tournament_id", TOURNAMENT_ID)
    .eq("judge_id", judge!.id)
    .single();
  expect(availabilityError).toBeNull();
  expect(availability?.status).toBe("limited");
  expect(availability?.notes).toBe("Available after the first round.");
  expect(availability?.confirmed_at).toBeTruthy();

  await page.goto(`/guardian-action/${token}`);
  await expect(page.getByText("Link unavailable")).toBeVisible();
});

test("expired guardian links fail closed", async ({ page }) => {
  await page.goto(`/guardian-action/${randomBytes(32).toString("base64url")}`);
  await expect(
    page.getByText("Link unavailable", { exact: true }).first(),
  ).toBeVisible();
});

test("staff approval commits the canonical membership, requirement, audit and receipt", async ({
  page,
}) => {
  const password = process.env.DV_LOCAL_TEST_PASSWORD;
  if (!password)
    throw new Error(
      "Set DV_LOCAL_TEST_PASSWORD before running DV Playwright tests.",
    );
  const plugin = adminClient().schema("plugin_data");
  const { data: season, error: seasonError } = await plugin
    .from("org_seasons")
    .select("id")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("is_current", true)
    .single();
  expect(seasonError).toBeNull();
  const { data: student, error: studentError } = await plugin
    .from("dv_sd_students")
    .select("id")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("school_email", "dv.student.b@local.test")
    .single();
  expect(studentError).toBeNull();
  const { data: membership, error: membershipError } = await plugin
    .from("dv_sd_seasonal_memberships")
    .select("id")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("season_id", season!.id)
    .eq("student_id", student!.id)
    .single();
  expect(membershipError).toBeNull();
  // This fixed fictional account belongs to the validated, owned local stack.
  const { error: fixtureError } = await plugin
    .from("dv_sd_seasonal_memberships")
    .update({
      status: "submitted",
      review_notes: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", membership!.id)
    .eq("organization_id", ORGANIZATION_ID);
  expect(fixtureError).toBeNull();
  const countReceipts = () =>
    plugin
      .from("dv_sd_membership_write_receipts")
      .select("request_id", { count: "exact", head: true })
      .eq("organization_id", ORGANIZATION_ID)
      .eq("membership_id", membership!.id);
  const countAudits = () =>
    plugin
      .from("dv_sd_audit_events")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORGANIZATION_ID)
      .eq("entity_id", membership!.id)
      .eq("action", "membership.approved");
  const beforeReceipts = await countReceipts();
  const beforeAudits = await countAudits();
  expect(beforeReceipts.error).toBeNull();
  expect(beforeAudits.error).toBeNull();

  const expectedPath = `/organization/${ORGANIZATION_SLUG}/plugins/dv-speech-debate`;
  await page.goto(`/login?redirect=${encodeURIComponent(expectedPath)}`);
  const main = page.getByRole("main");
  await expect(main.locator('form[data-hydrated="true"]')).toBeVisible();
  await expect(
    main.getByText("Secure check ready", { exact: true }),
  ).toBeVisible();
  await main
    .getByRole("textbox", { name: "Email" })
    .fill("dv.staff@local.test");
  await main.getByLabel("Password").fill(password);
  await main.getByRole("button", { name: "Login", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 60_000 })
    .toBe(expectedPath);
  await page.getByRole("tab", { name: "Membership", exact: true }).click();
  await page
    .getByRole("button", { name: "Review Blair Student", exact: true })
    .click();
  const review = page.getByRole("region", { name: "Review membership" });
  await expect(
    review.getByRole("heading", { name: "Saved application answers" }),
  ).toBeVisible();
  await review.getByLabel("Decision", { exact: true }).selectOption("approved");
  await review
    .getByLabel("Notes for the student")
    .fill("Approved in the fictional browser acceptance test.");
  await review
    .getByRole("button", { name: "Save decision", exact: true })
    .click();
  await expect(review).not.toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Blair Student" });
  await expect(row.getByText("Approved", { exact: true })).toBeVisible();

  const { data: decided, error: decidedError } = await plugin
    .from("dv_sd_seasonal_memberships")
    .select("status,review_notes,reviewed_by")
    .eq("organization_id", ORGANIZATION_ID)
    .eq("id", membership!.id)
    .single();
  expect(decidedError).toBeNull();
  expect(decided?.status).toBe("approved");
  expect(decided?.review_notes).toBe(
    "Approved in the fictional browser acceptance test.",
  );
  expect(decided?.reviewed_by).toBeTruthy();
  const { data: requirement, error: requirementError } = await plugin
    .from("dv_sd_membership_requirements")
    .select("status,verified_by")
    .eq("membership_id", membership!.id)
    .eq("requirement_type", "staff_review")
    .single();
  expect(requirementError).toBeNull();
  expect(requirement?.status).toBe("verified");
  expect(requirement?.verified_by).toBe(decided?.reviewed_by);
  const afterReceipts = await countReceipts();
  const afterAudits = await countAudits();
  expect(afterReceipts.error).toBeNull();
  expect(afterAudits.error).toBeNull();
  expect(afterReceipts.count).toBe((beforeReceipts.count ?? 0) + 1);
  expect(afterAudits.count).toBe((beforeAudits.count ?? 0) + 1);
});
