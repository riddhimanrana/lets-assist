import { expect, test, type Locator } from "@playwright/test";

async function expectPainted(locator: Locator) {
  // Next's streaming response may retain a hidden copy until its inline
  // replacement script runs. Assert the single visible copy, then inspect
  // opacity too because Playwright visibility accepts opacity:0.
  locator = locator.filter({ visible: true });
  await expect(locator).toHaveCount(1);
  // Catches a zero-size box, which is what a scale(0) entrance leaves behind.
  await expect(locator).toBeVisible();
  // Playwright visibility alone accepts opacity:0. Check every ancestor too.
  expect(
    await locator.evaluate((element) => {
      for (
        let current: Element | null = element;
        current;
        current = current.parentElement
      ) {
        const style = getComputedStyle(current);
        if (
          Number(style.opacity) === 0 ||
          style.display === "none" ||
          style.visibility === "hidden"
        ) {
          return false;
        }
      }
      return true;
    }),
  ).toBe(true);
}

for (const width of [390, 1440]) {
  for (const mode of ["without-js", "before-hydration"] as const) {
    test(
      "landing paints substantive sections " + mode + " at " + width + "px",
      async ({ browser, baseURL }, testInfo) => {
        if (!baseURL) {
          throw new Error(
            "Set LANDING_TEST_BASE_URL to an already-running public app.",
          );
        }
        const origin = new URL(baseURL).origin;
        const context = await browser.newContext({
          javaScriptEnabled: mode !== "without-js",
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        });
        try {
          // Blocking every script file holds the page at its server markup:
          // inline scripts still run, but nothing hydrates.
          await context.route("**/*", (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
              request.resourceType() === "script" ||
              (url.origin !== origin &&
                !["data:", "blob:"].includes(url.protocol))
            ) {
              return route.abort();
            }
            return route.continue();
          });
          const page = await context.newPage();
          await page.goto(new URL("/#journey", baseURL).href, {
            waitUntil: "domcontentloaded",
          });

          for (const [id, name] of [
            ["comparison", "Let's Assist is built for today."],
            ["journey", "From sign-up to certificate"],
            ["org-tooling", "The workspace SignUpGenius never built"],
          ]) {
            await expectPainted(
              page
                .locator("#" + id)
                .getByRole("heading", { name, exact: true }),
            );
          }

          const comparison = page.locator("#comparison");
          await expectPainted(
            comparison.getByText("Let's Assist is built for today."),
          );
          await expectPainted(
            comparison.getByText("QR check-in and check-out", { exact: true }),
          );
          await expectPainted(
            comparison.getByText("Explore opportunities", { exact: true }),
          );

          const journey = page.locator("#journey");
          await expectPainted(
            journey.getByText("Bellingham Square Park Cleanup", {
              exact: true,
            }),
          );
          for (const label of [
            "Browse feed",
            "Sign up & confirm",
            "QR check-in/out",
            "Track progress",
            "Get certified",
          ]) {
            await expectPainted(journey.getByText(label, { exact: true }));
          }

          const organization = page.locator("#org-tooling");
          for (const copy of [
            "Custom plugins",
            "Analytics dashboards",
            "Interactive organization demo",
          ]) {
            await expectPainted(organization.getByText(copy, { exact: true }));
          }
          for (const [name, destination] of [
            ["Contact us for integrations", "/contact"],
            ["Explore connected organizations", "/organization"],
          ]) {
            const link = organization.getByRole("link", { name });
            await expectPainted(link);
            await expect(link).toHaveAttribute("href", destination);
          }

          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width);
          await page.screenshot({
            path: testInfo.outputPath("landing-" + mode + "-" + width + ".png"),
            fullPage: true,
          });
        } finally {
          await context.close();
        }
      },
    );
  }
}

for (const width of [390, 1440]) {
  test(
    "landing demos remain keyboard operable after hydration at " + width + "px",
    async ({ browser, baseURL }) => {
      if (!baseURL) {
        throw new Error(
          "Set LANDING_TEST_BASE_URL to an already-running public app.",
        );
      }
      const origin = new URL(baseURL).origin;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const pageErrors: string[] = [];
      try {
        await context.route("**/*", (route) => {
          const url = new URL(route.request().url());
          return url.origin !== origin &&
            !["data:", "blob:"].includes(url.protocol)
            ? route.abort()
            : route.continue();
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => pageErrors.push(error.message));
        await page.goto(baseURL, { waitUntil: "domcontentloaded" });

        // This readiness flag belongs to the client-only mock. It proves
        // the client shell has mounted before testing hydrated interactions.
        const organization = page.locator("#org-tooling");
        await expect(
          organization.locator("[data-organization-tabs-hydrated]"),
        ).toHaveAttribute("data-organization-tabs-hydrated", "true");

        const journey = page.locator("#journey");
        const certificateStep = journey.getByRole("button", {
          name: /^Get certified/,
        });
        await certificateStep.focus();
        await page.keyboard.press("Enter");
        await expect(certificateStep).toHaveAttribute("aria-pressed", "true");
        await expect(
          journey.getByText("Riddhiman Rana", { exact: true }),
        ).toBeVisible();

        const comparison = page.locator("#comparison");
        const expand = comparison.getByRole("button", {
          name: "Show all 10 features",
        });
        await expand.focus();
        await page.keyboard.press("Enter");
        await expect(expand).toHaveCount(0);
        await expect(comparison.locator("tbody tr")).toHaveCount(10);

        if (width < 640) {
          const switcher = organization.getByRole("button", {
            name: "Overview — change section",
          });
          await switcher.focus();
          await page.keyboard.press("Enter");
          await page
            .getByRole("menuitem", { name: "Reports", exact: true })
            .focus();
          await page.keyboard.press("Enter");
          await expect(
            organization.getByRole("button", {
              name: "Reports — change section",
            }),
          ).toBeVisible();
        } else {
          const reports = organization.getByRole("tab", {
            name: "Reports",
            exact: true,
          });
          await reports.focus();
          await page.keyboard.press("Enter");
          await expect(reports).toHaveAttribute("aria-selected", "true");
        }
        await expect(
          page.locator("#org-tooling").getByRole("tabpanel"),
        ).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
}
