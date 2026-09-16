import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

/**
 * "Something is wrong?" end to end: a connected member files a report from
 * My CSF, an officer sees it on the Profiles tab and closes it with a note,
 * and the member reads that note back on My CSF.
 */

const runToken = Date.now().toString(36);
const reportMessage = `E2E report ${runToken}: the October meeting shows me absent but I signed in at the door.`;
const officerNote = `E2E note ${runToken}: corrected the October attendance to attended.`;

test.describe("member reports", () => {
  test.describe.configure({ mode: "serial" });

  let admin: SupabaseClient;
  let organizationId: string;

  test.beforeAll(async () => {
    const local = getCsfIsolatedSupabaseEnv();
    admin = createClient(local.url, local.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: organization, error } = await admin
      .from("organizations")
      .select("id")
      .eq("username", "dvhs-csf")
      .single();
    if (error || !organization) {
      throw new Error(
        `Could not load the local DVHS CSF organization: ${error?.message ?? "missing"}`,
      );
    }
    organizationId = organization.id;
  });

  test.afterAll(async () => {
    // Only the rows this run wrote. Audit events keep their immutable record.
    await admin
      .schema("plugin_data")
      .from("csf_member_reports")
      .delete()
      .eq("organization_id", organizationId)
      .eq("message", reportMessage);
  });

  test("a member files a report from My CSF", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "member", `${CSF_ORGANIZATION_PATH}?tab=csf-profile`);

    const summary = page.getByRole("region", { name: "CSF member profile" });
    await expect(summary).toBeVisible();
    await summary.getByRole("button", { name: /Something is wrong\?/ }).click();

    const dialog = page.getByRole("dialog", {
      name: "Report a problem with your record",
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("textbox", { name: "What should it say?" })
      .fill(reportMessage);
    await dialog.getByRole("button", { name: "Send to officers" }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => {
        const { data } = await admin
          .schema("plugin_data")
          .from("csf_member_reports")
          .select("status, category")
          .eq("organization_id", organizationId)
          .eq("message", reportMessage)
          .maybeSingle();
        return data;
      })
      .toEqual({ status: "open", category: "attendance" });

    expectNoBrowserFailures(failures);
  });

  test("an officer sees it on the Profiles tab and closes it with a note", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "admin", `${CSF_ORGANIZATION_PATH}?tab=csf-members`);

    const queue = page.locator("#member-reports");
    await expect(queue).toBeVisible();
    await expect(queue.getByText(/Reports from members/)).toBeVisible();
    const row = queue.locator("li").filter({ hasText: reportMessage });
    await expect(row).toBeVisible();
    await expect(row.getByText("A meeting attendance is wrong")).toBeVisible();

    await row
      .getByRole("textbox", { name: "Note to the member" })
      .fill(officerNote);
    await row.getByRole("button", { name: "Resolved", exact: true }).click();

    await expect
      .poll(async () => {
        const { data } = await admin
          .schema("plugin_data")
          .from("csf_member_reports")
          .select("status, resolution_note")
          .eq("organization_id", organizationId)
          .eq("message", reportMessage)
          .maybeSingle();
        return data;
      })
      .toEqual({ status: "resolved", resolution_note: officerNote });

    // Closed reports leave the queue.
    await expect(row).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("the member reads the officer's note on My CSF", async ({ page }) => {
    const failures = watchBrowserFailures(page);
    await loginAs(page, "member", `${CSF_ORGANIZATION_PATH}?tab=csf-profile`);

    const summary = page.getByRole("region", { name: "CSF member profile" });
    await summary.getByRole("button", { name: /Something is wrong\?/ }).click();
    const dialog = page.getByRole("dialog", {
      name: "Report a problem with your record",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Resolved", { exact: true }).first(),
    ).toBeVisible();
    await expect(dialog.getByText(officerNote)).toBeVisible();

    expectNoBrowserFailures(failures);
  });
});
