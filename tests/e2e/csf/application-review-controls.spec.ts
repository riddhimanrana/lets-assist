import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { CSF_ORGANIZATION_PATH, loginAs } from "./helpers";

let admin: SupabaseClient;
let organizationId: string;
let termId: string;
let cohortId: string;
let originalPeriod: Record<string, unknown> | null | undefined;
let applicationSnapshot: unknown;
const courseIds = Array.from({ length: 36 }, () => randomUUID());

function checked(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function readApplications() {
  const { data, error } = await admin
    .schema("plugin_data")
    .from("csf_term_applications")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("term_id", termId)
    .order("id");
  checked(error);
  return data;
}

test.beforeAll(async () => {
  const local = getCsfIsolatedSupabaseEnv();
  admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plugin = admin.schema("plugin_data");
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("username", "dvhs-csf")
    .single();
  checked(orgError);
  organizationId = org!.id;
  const { data: term, error: termError } = await plugin
    .from("csf_terms")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("code", "S26")
    .single();
  checked(termError);
  termId = term!.id;
  const { data: cohort, error: cohortError } = await plugin
    .from("csf_cohorts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("graduation_year", 2028)
    .single();
  checked(cohortError);
  cohortId = cohort!.id;
  const { data: period, error: periodError } = await plugin
    .from("csf_review_periods")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("term_id", termId)
    .eq("kind", "membership_applications")
    .maybeSingle();
  checked(periodError);
  originalPeriod = period;
  applicationSnapshot = await readApplications();
  const { data: application, error: applicationError } = await plugin
    .from("csf_term_applications")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("term_id", termId)
    .eq("most_checked_email", "evan.chen@example.test")
    .single();
  checked(applicationError);
  checked(
    (
      await plugin.from("csf_application_course_entries").insert(
        courseIds.map((id, index) => ({
          id,
          organization_id: organizationId,
          application_id: application!.id,
          course_list: "I",
          course_name: `Fictional course ${index + 1}`,
          raw_line: `Fictional course ${index + 1}: imported text remains readable while the page scrolls.`,
        })),
      )
    ).error,
  );
});

test.afterAll(async () => {
  if (!admin || !organizationId) return;
  const plugin = admin.schema("plugin_data");
  checked(
    (
      await plugin
        .from("csf_application_course_entries")
        .delete()
        .eq("organization_id", organizationId)
        .in("id", courseIds)
    ).error,
  );
  if (originalPeriod) {
    checked(
      (
        await plugin
          .from("csf_review_periods")
          .update(originalPeriod)
          .eq("organization_id", organizationId)
          .eq("id", String(originalPeriod.id))
      ).error,
    );
  } else if (originalPeriod === null && termId) {
    checked(
      (
        await plugin
          .from("csf_review_periods")
          .delete()
          .eq("organization_id", organizationId)
          .eq("term_id", termId)
          .eq("kind", "membership_applications")
      ).error,
    );
  }
});

test("application review opens, closes and reopens without resetting decisions, with one page scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(
    page,
    "admin",
    `${CSF_ORGANIZATION_PATH}?tab=csf-applications&csf_review_term=${termId}&csf_review_cohort=${cohortId}`,
  );
  await expect(
    page.locator('[data-organization-tabs-hydrated="true"]'),
  ).toBeVisible();
  const tour = page.getByRole("dialog", { name: "Officer workspace tour" });
  if (await tour.isVisible()) {
    await tour.getByRole("button", { name: "Skip tour", exact: true }).click();
    await expect(tour).toBeHidden();
  }
  if (
    await page
      .getByRole("button", { name: "Reopen review", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "Reopen review", exact: true })
      .click();
  } else if (
    await page
      .getByRole("button", { name: "Open review", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "Open review", exact: true })
      .click();
  }
  await expect(
    page.getByRole("button", { name: "Close review", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close review", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reopen review", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Application decisions are closed for this semester. Reopening review preserves previous decisions.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reopen review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Close review", exact: true }),
  ).toBeVisible();
  expect(await readApplications()).toEqual(applicationSnapshot);
  const { count, error } = await admin
    .schema("plugin_data")
    .from("csf_admin_audit_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("term_id", termId)
    .eq("action", "review_period.reopened");
  checked(error);
  expect(count).toBeGreaterThan(0);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Chen, Evan", exact: true }).click();
    const queue = page
      .getByRole("button", { name: "Back to roster", exact: true })
      .locator("..")
      .locator("..");
    await expect(
      queue.getByText(
        "Fictional course 36: imported text remains readable while the page scrolls.",
        { exact: true },
      ),
    ).toBeAttached();
    expect(
      await queue.evaluate(
        (root) =>
          [...root.querySelectorAll("*")].filter((element) => {
            const style = getComputedStyle(element);
            return (
              ["auto", "scroll"].includes(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 1
            );
          }).length,
      ),
    ).toBe(0);
    const beforeScroll = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(beforeScroll);
    await expect(
      queue.getByText("Evan Chen", { exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Next subject", exact: true })
      .click();
    await expect(queue.getByText("Evan Chen", { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => (await queue.boundingBox())?.y ?? -1)
      .toBeGreaterThanOrEqual(0);
    await page
      .getByRole("button", { name: "Back to roster", exact: true })
      .click();
  }
});
