import { expect, test } from "@playwright/test";
import { format, parseISO } from "date-fns";
import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { landingDemoDate } from "../../../app/(landing)/_components/landing-demo-dates";

for (const timezoneId of ["UTC", "America/Los_Angeles"]) {
  test(`landing demo hydrates the server calendar in ${timezoneId}`, async ({
    browser,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("An owned isolated app is required.");
    const local = getCsfIsolatedSupabaseEnv();
    const allowed = new Set([
      new URL(baseURL).origin,
      new URL(local.url).origin,
    ]);
    const context = await browser.newContext({
      timezoneId,
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
      serviceWorkers: "block",
    });
    const failures = { pageErrors: 0, consoleErrors: 0, refusedRequests: 0 };
    try {
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (
          !allowed.has(new URL(request.url()).origin) ||
          !["GET", "HEAD", "OPTIONS"].includes(request.method())
        ) {
          failures.refusedRequests++;
          await route.abort();
          return;
        }
        await route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", () => failures.pageErrors++);
      page.on("console", (message) => {
        if (message.type() === "error") failures.consoleErrors++;
      });
      const response = await page.goto(`${baseURL}/?noRedirect=1`);
      if (!response || response.status() !== 200)
        throw new Error("Public landing response was not successful.");
      const html = await response.text();
      const anchor = html.match(/data-demo-date-anchor="([0-9-]{10})"/u)?.[1];
      if (!anchor) throw new Error("Serialized demo calendar date is missing.");
      const expected = `${format(parseISO(landingDemoDate(anchor, 31)), "MMM d")} - ${format(parseISO(landingDemoDate(anchor, 32)), "MMM d, yyyy")}`;
      const demo = page.locator("[data-demo-date-anchor]");
      await expect(demo.getByText(expected, { exact: true })).toBeVisible();
      const toggle = demo.getByRole("button", {
        name: "Click here to scroll on this demo",
        exact: true,
      });
      await toggle.click();
      await expect(
        demo.getByRole("button", { name: "Demo scroll on", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(demo.getByText(expected, { exact: true })).toBeVisible();
      expect(failures).toEqual({
        pageErrors: 0,
        consoleErrors: 0,
        refusedRequests: 0,
      });
    } finally {
      await context.close();
    }
  });
}
