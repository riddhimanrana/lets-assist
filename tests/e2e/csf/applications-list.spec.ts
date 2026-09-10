import { expect, test } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const applicationsPath = `${CSF_ORGANIZATION_PATH}?tab=csf-applications`;

test.describe("applications review workspace", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin", applicationsPath);
  });

  test("mounts the review workspace pinned to the application campaign", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);

    // The Applications tab is the application review campaign: the shared
    // review chrome renders (period bar + roster scaffolding), and the
    // Points/Applications campaign toggle stays hidden because the route
    // pins the kind.
    await expect(page.locator("#applications")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Points", exact: true }),
    ).toBeHidden();

    // The old queue vocabulary is gone.
    await expect(
      page.getByRole("navigation", { name: "Application work queues" }),
    ).toHaveCount(0);

    expectNoBrowserFailures(failures);
  });

  test("keeps the import entry point for officers who can import", async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);

    const importButton = page.getByRole("button", {
      name: "Link Google Sheet",
      exact: true,
    });
    await expect(importButton).toBeVisible();
    await importButton.click();
    await expect(page).toHaveURL(/csf_import_type=application_responses/);
    const dialog = page.getByRole("dialog", { name: "Application Sheet" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Connect the response Sheet once.");
    await expect(dialog).toContainText(
      "Importing never approves an application.",
    );
    await expect(
      page.getByRole("navigation", { name: "Import progress" }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/csf_import_type=/);
    await expect(page.locator("#applications")).toBeVisible();
    await importButton.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#applications")).toBeVisible();

    expectNoBrowserFailures(failures);
  });
});
