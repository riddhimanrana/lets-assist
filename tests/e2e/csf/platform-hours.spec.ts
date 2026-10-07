import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { loginAs } from "./helpers";

test.use({ timezoneId: "America/Los_Angeles", locale: "en-US" });

test("self-reported hours reject a missing local time and preserve a DST interval through the certificate", async ({
  page,
}) => {
  const local = getCsfIsolatedSupabaseEnv();
  const admin = createClient(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const title = `E2E timezone ${randomUUID()}`;
  const matching = () =>
    admin
      .from("certificates")
      .select("id", { count: "exact", head: true })
      .eq("project_title", title)
      .eq("type", "self-reported");

  try {
    await loginAs(page, "member", "/dashboard");
    await page
      .getByRole("button", { name: "Add Self-Reported Hours", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Add Self-Reported Hours",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Title *", { exact: true }).fill(title);
    await dialog
      .getByLabel("Creator / Supervisor *", { exact: true })
      .fill("Fictional timezone supervisor");
    await dialog
      .getByRole("button", { name: "Select date", exact: true })
      .click();
    const calendar = page.locator('[data-slot="calendar"]');
    await expect(calendar).toBeVisible();
    const date = calendar.locator('[data-day="3/8/2026"]');
    for (let month = 0; month < 120 && (await date.count()) === 0; month++) {
      await calendar.getByRole("button", { name: /previous month/i }).click();
    }
    await expect(date).toHaveCount(1);
    await date.click();
    const times = dialog.locator('input[type="time"]');
    await expect(times).toHaveCount(2);
    await times.nth(0).fill("02:30");
    await times.nth(1).fill("04:30");
    const invalidResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/self-reported-hours" &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Add Hours", exact: true })
      .click();
    const invalid = await invalidResponse;
    expect(invalid.status()).toBe(400);
    expect(invalid.request().postDataJSON()).toMatchObject({
      title,
      date: "2026-03-08",
      startTime: "02:30",
      timeZone: "America/Los_Angeles",
    });
    await expect(
      page.getByText(
        "This local time does not exist in the selected time zone.",
        { exact: true },
      ),
    ).toBeVisible();
    const rejectedRows = await matching();
    expect(rejectedRows.error).toBeNull();
    expect(rejectedRows.count).toBe(0);
    await expect(dialog.getByLabel("Title *", { exact: true })).toHaveValue(
      title,
    );

    await times.nth(0).fill("01:30");
    await times.nth(1).fill("03:30");
    await expect(
      dialog.getByText("Duration: 1h", { exact: true }),
    ).toBeVisible();
    const validResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/self-reported-hours" &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Add Hours", exact: true })
      .click();
    const valid = await validResponse;
    expect(valid.status()).toBe(200);
    const result = await valid.json();
    expect(result.success).toBe(true);
    expect(result.certificate.type).toBe("self-reported");
    const stored = await admin
      .from("certificates")
      .select("id,event_start,event_end,is_certified,type")
      .eq("id", result.certificate.id)
      .eq("project_title", title)
      .single();
    expect(stored.error).toBeNull();
    expect(stored.data?.is_certified).toBe(false);
    expect(new Date(stored.data!.event_start).toISOString()).toBe(
      "2026-03-08T09:30:00.000Z",
    );
    expect(new Date(stored.data!.event_end).toISOString()).toBe(
      "2026-03-08T10:30:00.000Z",
    );
    await page.goto(`/certificates/${result.certificate.id}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", {
        name: "Self-Reported Certificate",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("1 hour", { exact: true })).toBeVisible();
  } finally {
    const cleanup = await admin
      .from("certificates")
      .delete()
      .eq("project_title", title)
      .eq("type", "self-reported");
    expect(cleanup.error).toBeNull();
    const remaining = await matching();
    expect(remaining.error).toBeNull();
    expect(remaining.count).toBe(0);
  }
});
