import { expect, test } from "@playwright/test";

import {
  CSF_ORGANIZATION_PATH,
  expectNoBrowserFailures,
  loginAs,
  watchBrowserFailures,
} from "./helpers";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`My CSF keeps the profile and history on one semester at ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const failures = watchBrowserFailures(page);
    await loginAs(page, "member", `${CSF_ORGANIZATION_PATH}?csf_tour=member`);
    const tour = page.getByRole("dialog", { name: "Member workspace tour" });
    await expect(tour).toBeVisible();
    await tour.getByRole("button", { name: "Skip tour", exact: true }).click();
    await expect(tour).toBeHidden();
    await page.goto(`${CSF_ORGANIZATION_PATH}?tab=csf-profile`);
    await expect(page).toHaveURL(/tab=csf-profile/);
    const profile = page.getByRole("region", { name: "CSF member profile" });
    const semesters = page.getByRole("tablist", { name: "Member semesters" });
    const points = profile
      .getByText("Service points", { exact: true })
      .locator("..");
    const activities = profile
      .getByText("Activities", { exact: true })
      .locator("..");
    const meetings = profile
      .getByText("Meetings", { exact: true })
      .locator("..");

    await expect(
      profile.getByRole("heading", { name: "Aarav Mehta", exact: true }),
    ).toBeVisible();
    await expect(profile).toContainText("Spring 2026");
    await expect(
      semesters.getByRole("tab", { name: "Spring 2026", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(points).toHaveText(/2\s*Service points/);
    await expect(activities).toHaveText(/2\s*Activities/);
    await expect(meetings).toHaveText(/1\s*Meetings/);
    await expect(
      page.getByRole("heading", { name: "Spring 2026", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Quail Run Suessical Musical", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Spring General Meeting", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`profile-history-${viewport.name}.png`),
    });

    await semesters.getByRole("tab", { name: /^Fall 2026/ }).click();
    await expect(profile).toContainText("Fall 2026");
    await expect(points).toHaveText(/0\s*Service points/);
    await expect(activities).toHaveText(/0\s*Activities/);
    await expect(meetings).toHaveText(/0\s*Meetings/);
    await expect(
      page.getByRole("heading", { name: "Fall 2026", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`profile-current-${viewport.name}.png`),
    });

    await semesters
      .getByRole("tab", { name: "Spring 2026", exact: true })
      .click();
    await expect(profile).toContainText("Spring 2026");
    await expect(points).toHaveText(/2\s*Service points/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expectNoBrowserFailures(failures);
  });
}
