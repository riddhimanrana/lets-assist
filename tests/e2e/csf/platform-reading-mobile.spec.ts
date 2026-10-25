import { expect, test } from "@playwright/test";
import { expectNoBrowserFailures, watchBrowserFailures } from "./helpers";

test.use({ viewport: { width: 375, height: 812 } });

for (const colorScheme of ["light", "dark"] as const) {
  test(`privacy permission URLs wrap inside the phone in ${colorScheme} mode`, async ({
    page,
  }) => {
    const failures = watchBrowserFailures(page);
    await page.emulateMedia({ colorScheme });
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { name: "Privacy Policy", exact: true }),
    ).toBeVisible();
    const permission = page.locator("article strong").filter({
      hasText: "https://www.googleapis.com/auth/calendar.app.created",
    });
    await expect(permission).toHaveCount(1);
    await permission.scrollIntoViewIfNeeded();
    const geometry = await permission.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        textInViewport: [...range.getClientRects()].every(
          (box) => box.left >= 0 && box.right <= innerWidth,
        ),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      };
    });
    expect(geometry.textInViewport).toBe(true);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expectNoBrowserFailures(failures);
  });
}
