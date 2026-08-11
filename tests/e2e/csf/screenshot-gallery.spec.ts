import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { CSF_ORGANIZATION_PATH, CSF_PUBLIC_PATH, loginAs } from "./helpers";

const captureGallery = process.env.CSF_CAPTURE_GALLERY === "1";
const screenshotDir =
  process.env.CSF_SCREENSHOT_DIR ??
  path.join(
    process.cwd(),
    "artifacts",
    "dvhs-csf-e2e",
    process.env.CSF_E2E_RUN_ID ?? "playwright-local",
    "screenshots",
  );

async function capture(page: Page, name: string) {
  await mkdir(screenshotDir, { recursive: true });
  await page
    .waitForFunction(
      () =>
        Array.from(document.images).every(
          (image) =>
            !image.offsetParent || (image.complete && image.naturalWidth > 0),
        ),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
  await page.screenshot({
    path: path.join(screenshotDir, `${name}.png`),
    fullPage: true,
    caret: "initial",
  });
}

async function openGalleryRoute(page: Page, route: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(route, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await page.waitForTimeout(1_000);
    }
  }
  throw lastError;
}

test.describe("sanitized DVHS CSF screenshot gallery", () => {
  test.describe.configure({ timeout: 240_000 });
  test.skip(
    !captureGallery,
    "Set CSF_CAPTURE_GALLERY=1 to capture the gallery.",
  );

  test("captures the complete officer workspace", async ({ page }) => {
    await loginAs(page, "admin");

    const routes = [
      [
        "40-home-admin",
        `${CSF_ORGANIZATION_PATH}?tab=csf-overview`,
        "Your tasks",
      ],
      [
        "41-applications-list",
        `${CSF_ORGANIZATION_PATH}?tab=csf-applications`,
        "Review queue",
      ],
      [
        "43-members-directory",
        `${CSF_ORGANIZATION_PATH}?tab=csf-members`,
        "Current membership",
      ],
      [
        "44-service-activities",
        `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_service=opportunities`,
        "Activities",
      ],
      [
        "45-service-points",
        `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_service=points`,
        "Awaiting review",
      ],
      [
        "46-service-meetings",
        `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_service=meetings`,
        "Schedule required meetings",
      ],
      [
        "47-service-partner-clubs",
        `${CSF_ORGANIZATION_PATH}?tab=csf-activities&csf_service=partner-clubs`,
        "Club Directory",
      ],
      [
        "48-semester",
        `${CSF_ORGANIZATION_PATH}?tab=csf-cohorts`,
        // The cohorts tab is the class hub: "Schedule & deadlines" now lives
        // inside the collapsed "Semesters & setup" disclosure, so the marker
        // asserts the setup trigger the collapsed hub actually shows.
        "Semesters & setup",
      ],
      [
        "49-imports",
        `${CSF_ORGANIZATION_PATH}?tab=csf-imports`,
        "Import records",
      ],
      [
        "50-reports",
        `${CSF_ORGANIZATION_PATH}?tab=csf-reports`,
        "Semester reports",
      ],
      [
        "51-staff-access",
        `${CSF_ORGANIZATION_PATH}?tab=csf-staff`,
        "Officer roster",
      ],
      [
        "52-change-history",
        `${CSF_ORGANIZATION_PATH}?tab=csf-audit`,
        "Change history",
      ],
      [
        "53-csf-settings",
        `${CSF_ORGANIZATION_PATH}?tab=csf-settings`,
        "Settings",
      ],
    ] as const;

    for (const [name, route, marker] of routes) {
      await openGalleryRoute(page, route);
      const tabpanel = page.locator('[role="tabpanel"]:visible').first();
      await expect(tabpanel).toBeVisible();
      await expect(
        tabpanel.getByText(marker, { exact: false }).first(),
      ).toBeVisible();
      await capture(page, name);

      if (name === "48-semester") {
        // Prove the marker is the *collapsed* hub truth: the class picker and
        // the server-derived cutover summary are both readable without opening
        // the disclosure, and the gallery never expands it.
        await expect(
          tabpanel.getByRole("heading", { name: "Your classes" }),
        ).toBeVisible();
        const setupTrigger = tabpanel.getByRole("button", {
          name: "Semesters & setup",
        });
        await expect(setupTrigger).toHaveAttribute("aria-expanded", "false");
        await expect(
          setupTrigger.getByText(/of \d+ setup checkpoints? recorded/),
        ).toBeVisible();
      }

      if (name === "41-applications-list") {
        const reviewLinks = page.locator('a[href*="csf_application="]');
        expect(await reviewLinks.count()).toBeGreaterThan(0);
        await reviewLinks.first().click();
        await expect(page).toHaveURL(/csf_application=/);
        await capture(page, "42-application-review");
      }
    }
  });

  test("captures member and public views", async ({ page }) => {
    await loginAs(page, "member");
    await openGalleryRoute(page, CSF_ORGANIZATION_PATH);
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await capture(page, "54-member-my-csf");

    await openGalleryRoute(page, CSF_PUBLIC_PATH);
    await capture(page, "55-public-page");
  });

  test("captures responsive officer home views", async ({ page }) => {
    await loginAs(page, "admin");
    for (const viewport of [
      { name: "phone", width: 390, height: 844 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "desktop", width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await openGalleryRoute(
          page,
          `${CSF_ORGANIZATION_PATH}?tab=csf-overview`,
        );
        await expect(
          page.getByRole("region", { name: "Your tasks" }),
        ).toBeVisible();
        await capture(page, `56-home-${viewport.name}-${colorScheme}`);
      }
    }
  });
});
