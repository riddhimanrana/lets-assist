import { expect, test, type Page } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

const applicationsPath = `${CSF_ORGANIZATION_PATH}?tab=csf-applications`;

/**
 * The applications section inside the tab that is actually open.
 *
 * The workspace keeps an inactive tab's markup mounted and inert, so `#applications`
 * can match a cached copy as well as the live one. The accessible tabpanel is the
 * open tab by definition, and the count check below keeps this from hiding a second
 * copy that really is on screen.
 */
function applicationsPanel(page: Page) {
  return page.getByRole("tabpanel").locator("#applications");
}

async function expectOneVisibleApplicationsPanel(page: Page) {
  await expect(applicationsPanel(page)).toBeVisible();
  await expect(
    page.locator("#applications").filter({ visible: true }),
  ).toHaveCount(1);
}

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
    await expectOneVisibleApplicationsPanel(page);
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
    const dialog = page.getByRole("dialog", {
      name: /^(Match students|Connect a Sheet)$/,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      /Applications stay pending until you release decisions.|Choose your application responses Sheet./,
    );
    await expect(
      page.getByRole("navigation", { name: "Import progress" }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/csf_import_type=/);
    await expectOneVisibleApplicationsPanel(page);
    await importButton.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expectOneVisibleApplicationsPanel(page);

    expectNoBrowserFailures(failures);
  });
});
