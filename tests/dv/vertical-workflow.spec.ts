import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { getLocalSupabaseEnv } from "../../scripts/local-dev/dv-local-env.mjs";

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
    throw new Error("Set DV_LOCAL_TEST_PASSWORD before running DV Playwright tests.");
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
  await expect(main.getByText("Secure check ready", { exact: true })).toBeVisible();
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
  await expect(page.getByText("Confirm judging availability")).toBeVisible();
  const limitedAvailability = page.getByRole("radio", {
    name: "Available for some rounds",
  });
  await limitedAvailability.click();
  await expect(limitedAvailability).toBeChecked();
  await page.getByLabel("Notes").fill("Available after the first round.");
  await page.getByRole("button", { name: "Confirm availability" }).click();
  await expect(
    page.getByRole("alert").getByText("Availability recorded"),
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
  await expect(page.getByText("Link unavailable")).toBeVisible();
});
