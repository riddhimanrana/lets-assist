import { expect, test } from "@playwright/test";

import {
  CSF_PUBLIC_PATH,
  expectNoBrowserFailures,
  expectNoHorizontalOverflow,
  watchBrowserFailures,
} from "./helpers";

for (const viewport of [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
]) {
  test(`${viewport.name} public workspace works in light and dark mode`, async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    const colors: string[] = [];
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(CSF_PUBLIC_PATH);
      await expect(
        page.getByRole("heading", {
          name: /DVHS CSF|Dougherty Valley High School(?: CSF)?/,
        }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      colors.push(
        await page
          .locator("body")
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      );
    }

    expect(colors[0]).not.toBe(colors[1]);
    expectNoBrowserFailures(failures);
  });
}
