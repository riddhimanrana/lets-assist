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
            ["comparison", "Let's Assist is built for volunteer hours."],
            ["journey", "From sign-up to certificate"],
            ["org-tooling", "A workspace for your volunteer organization"],
          ]) {
            await expectPainted(
              page
                .locator("#" + id)
                .getByRole("heading", { name, exact: true }),
            );
          }

          const comparison = page.locator("#comparison");
          await expectPainted(
            comparison.getByText("Let's Assist is built for volunteer hours."),
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

// Accessibility follow-up. These cases have not been run: they wait for the
// Chrome pass, along with the axe scan and the visual review, which this file
// does not perform.
const TESTIMONIALS_LABEL = "Testimonials from teachers and advisors";

for (const width of [390, 1440]) {
  test(
    "landing static sections are in the first response at " + width + "px",
    async ({ browser, baseURL }) => {
      if (!baseURL) {
        throw new Error(
          "Set LANDING_TEST_BASE_URL to an already-running public app.",
        );
      }
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await page.goto(baseURL, { waitUntil: "domcontentloaded" });

        await expectPainted(
          page.locator("#check-in").getByRole("heading", {
            name: "This is what check-in looks like",
            exact: true,
          }),
        );
        const testimonials = page.getByRole("region", {
          name: TESTIMONIALS_LABEL,
          exact: true,
        });
        await expectPainted(testimonials);
        await expect(testimonials.getByRole("article")).toHaveCount(8);
      } finally {
        await context.close();
      }
    },
  );

  // Not run. This context leaves motion at its default, so the journey cycles
  // every 3s until a step is chosen. It emulates nothing on the machine.
  test(
    "landing journey keeps a chosen step under normal motion at " +
      width +
      "px",
    async ({ browser, baseURL }) => {
      if (!baseURL) {
        throw new Error(
          "Set LANDING_TEST_BASE_URL to an already-running public app.",
        );
      }
      const origin = new URL(baseURL).origin;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: "no-preference",
      });
      try {
        await context.route("**/*", (route) => {
          const url = new URL(route.request().url());
          return url.origin !== origin &&
            !["data:", "blob:"].includes(url.protocol)
            ? route.abort()
            : route.continue();
        });
        const page = await context.newPage();
        await page.goto(baseURL, { waitUntil: "domcontentloaded" });
        await expect(
          page
            .locator("#org-tooling")
            .locator("[data-organization-tabs-hydrated]"),
        ).toHaveAttribute("data-organization-tabs-hydrated", "true");

        const journey = page.locator("#journey");
        const pills = journey.getByRole("button", {
          name: /^Show step \d of 5: /,
        });
        const cards = journey.getByRole("button", {
          name: /^(?:Browse feed|Sign up & confirm|QR check-in\/out|Track progress|Get certified)/,
        });
        await expect(pills).toHaveCount(5);
        await expect(cards).toHaveCount(5);

        // The cycle is running: the first step gives way once in view.
        await journey.scrollIntoViewIfNeeded();
        await expect(pills.nth(0)).toHaveAttribute("aria-pressed", "false", {
          timeout: 10_000,
        });

        // Choose the dashboard step from the keyboard. Its preview replaces
        // the previous one at once, whatever that one was doing.
        await pills.nth(3).focus();
        await page.keyboard.press("Enter");
        const expectDashboardSelected = async () => {
          await expect
            .poll(() =>
              pills.evaluateAll((elements) =>
                elements.map((element) => element.getAttribute("aria-pressed")),
              ),
            )
            .toEqual(["false", "false", "false", "true", "false"]);
          await expect(cards.nth(3)).toHaveAttribute("aria-pressed", "true");
          await expectPainted(
            journey.getByText("Semester trend", { exact: true }),
          );
          // Only the chosen preview is mounted. The feed and certificate
          // previews both name this project, and neither lingers.
          await expect(
            journey.getByText("Bellingham Square Park Cleanup", {
              exact: true,
            }),
          ).toHaveCount(0);
        };
        await expectDashboardSelected();

        // Longer than one 3s cycle. The choice and its preview stay put.
        await page.waitForTimeout(4_000);
        await expectDashboardSelected();
        await expect(pills.nth(3)).toBeFocused();
      } finally {
        await context.close();
      }
    },
  );

  test(
    "landing accessibility fixes hold after hydration at " + width + "px",
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
      const hydrationMessages: string[] = [];
      try {
        await context.route("**/*", (route) => {
          const url = new URL(route.request().url());
          return url.origin !== origin &&
            !["data:", "blob:"].includes(url.protocol)
            ? route.abort()
            : route.continue();
        });
        const page = await context.newPage();
        // A production build reports a mismatch as a minified React error.
        const hydrationPattern = /hydrat|React error #(?:418|423|425)/i;
        page.on("console", (message) => {
          if (hydrationPattern.test(message.text())) {
            hydrationMessages.push(message.text());
          }
        });
        page.on("pageerror", (error) => {
          if (hydrationPattern.test(error.message)) {
            hydrationMessages.push(error.message);
          }
        });
        await page.goto(baseURL, { waitUntil: "domcontentloaded" });
        await expect(
          page
            .locator("#org-tooling")
            .locator("[data-organization-tabs-hydrated]"),
        ).toHaveAttribute("data-organization-tabs-hydrated", "true");

        // Each hero link is one keyboard stop; its motion wrapper is not.
        for (const name of ["Run a volunteer event", "Contact us"]) {
          const link = page
            .getByRole("main")
            .getByRole("link", { name, exact: true })
            .first();
          await expect(link).toBeVisible();
          expect(
            await link.evaluate(
              (element) =>
                element.closest<HTMLElement>("div[tabindex]")?.tabIndex ?? null,
            ),
          ).toBe(-1);
        }

        // The animated heading is read once and carries no aria-label.
        const closing = page.locator("#cta").getByRole("heading", {
          name: "Who will you help next?",
          exact: true,
        });
        await expect(closing).toHaveCount(1);
        await expect(closing.locator("[aria-label]")).toHaveCount(0);

        // Pagination pills: a real target of at least 24px, operable by key.
        const pills = page
          .locator("#journey")
          .getByRole("button", { name: /^Show step \d of 5: / });
        await expect(pills).toHaveCount(5);
        for (const pill of await pills.all()) {
          const box = await pill.boundingBox();
          expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
        }
        await pills.nth(2).focus();
        await page.keyboard.press("Enter");
        await expect(pills.nth(2)).toHaveAttribute("aria-pressed", "true");

        // The testimonial row takes focus and scrolls from the keyboard.
        const testimonials = page.getByRole("region", {
          name: TESTIMONIALS_LABEL,
          exact: true,
        });
        await testimonials.focus();
        await expect(testimonials).toBeFocused();
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(() => testimonials.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
        await page.keyboard.press("End");
        await expect
          .poll(() =>
            testimonials.evaluate(
              (element) =>
                element.scrollWidth - element.clientWidth - element.scrollLeft,
            ),
          )
          .toBeLessThanOrEqual(1);
        await page.keyboard.press("Home");
        await expect
          .poll(() => testimonials.evaluate((element) => element.scrollLeft))
          .toBe(0);
        await expect(
          testimonials.getByText("Minu Basu", { exact: true }),
        ).toHaveCount(1);

        // No ancestor fades the comparison labels the axe scan reported.
        const comparison = page.locator("#comparison");
        for (const label of [
          "signupgenius.com",
          "AD",
          "Volunteer Signup Sheet",
          "Illustrative mock",
        ]) {
          const node = comparison
            .getByText(label, { exact: true })
            .filter({ visible: true });
          await expect(node).toHaveCount(1);
          expect(
            await node.evaluate((element) => {
              let opacity = 1;
              for (
                let current: Element | null = element;
                current;
                current = current.parentElement
              ) {
                opacity *= Number(getComputedStyle(current).opacity);
              }
              return opacity;
            }),
          ).toBe(1);
        }

        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        expect(hydrationMessages).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
}
