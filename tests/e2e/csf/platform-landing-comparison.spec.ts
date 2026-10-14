import { expect, test } from "@playwright/test";
import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";

for (const width of [320, 390, 414]) {
  test(`comparison phrase cycle keeps heading and page height at ${width}px`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    if (!baseURL) throw new Error("An owned isolated app is required.");
    const local = getCsfIsolatedSupabaseEnv();
    const origins = new Set([
      new URL(baseURL).origin,
      new URL(local.url).origin,
    ]);
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "no-preference",
      colorScheme: "light",
      serviceWorkers: "block",
    });
    const faults = { page: 0, console: 0, refused: 0 };
    try {
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (
          !origins.has(new URL(request.url()).origin) ||
          !["GET", "HEAD", "OPTIONS"].includes(request.method())
        ) {
          faults.refused++;
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", () => faults.page++);
      page.on("console", (message) => {
        if (message.type() === "error") faults.console++;
      });
      await page.goto(`${baseURL}/?noRedirect=1`);
      const initialDimensions = await page.evaluate(() => ({
        documentHeight: document.documentElement.scrollHeight,
        organizationDemoPresent: !!document.querySelector(
          "#org-tooling .relative.mx-auto.mt-12.w-full.max-w-6xl",
        ),
        partnersPresent: !!document.getElementById("partners"),
        closingSectionPresent: !!document.getElementById("cta"),
      }));
      // These client-only regions can still replace a short placeholder or
      // insert a section after the comparison itself is ready. Start the
      // phrase-cycle guarantee only after the complete landing tree exists.
      await page.waitForFunction(
        () => {
          const selectors = [
            "#partners",
            "#check-in",
            "#journey",
            "#cta",
            "#org-tooling .relative.mx-auto.mt-12.w-full.max-w-6xl",
          ];
          return selectors.every((selector) => {
            const node = document.querySelector(selector);
            const rect = node?.getBoundingClientRect();
            return rect && rect.width > 0 && rect.height > 0;
          });
        },
        null,
        { timeout: 12_000 },
      );
      await page
        .locator('[data-slot="comparison-word"]')
        .scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () => document.fonts.status === "loaded",
        null,
        {
          timeout: 12_000,
        },
      );
      const result = await page.evaluate(async () => {
        const frame = document.querySelector('[data-slot="comparison-word"]');
        const heading = frame?.closest("h2");
        if (!frame || !heading)
          throw new Error("Comparison heading is missing.");
        const seen = new Set<string>();
        const heights = new Set<number>();
        const documents = new Set<number>();
        const heightChanges: Array<{
          elapsedMs: number;
          documentHeight: number;
          sections: Array<{ id: string; top: number; height: number }>;
        }> = [];
        const start = performance.now();
        let previousHeight = -1;
        let overflow = false;
        while (performance.now() - start < 11_500) {
          const word = frame.querySelector('span:not([aria-hidden="true"])');
          if (word && Number(getComputedStyle(word).opacity) > 0.995)
            seen.add(word.textContent?.trim() ?? "");
          heights.add(heading.getBoundingClientRect().height);
          const documentHeight = document.documentElement.scrollHeight;
          documents.add(documentHeight);
          if (documentHeight !== previousHeight && heightChanges.length < 32) {
            heightChanges.push({
              elapsedMs: Math.round(performance.now() - start),
              documentHeight,
              sections: [
                "partners",
                "comparison",
                "check-in",
                "journey",
                "org-tooling",
                "testimonials",
                "cta",
              ].flatMap((id) => {
                const node = document.getElementById(id);
                if (!node) return [];
                const rect = node.getBoundingClientRect();
                return [
                  {
                    id,
                    top: Math.round(rect.top + scrollY),
                    height: Math.round(rect.height),
                  },
                ];
              }),
            });
          }
          previousHeight = documentHeight;
          overflow ||= document.documentElement.scrollWidth > innerWidth;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        return {
          words: [...seen].sort(),
          heights: heights.size,
          documents: documents.size,
          overflow,
          heightChanges,
        };
      });
      await testInfo.attach("comparison-layout-dimensions", {
        contentType: "application/json",
        body: JSON.stringify({
          width,
          initialDimensions,
          heightChanges: result.heightChanges,
          faults,
        }),
      });
      const { heightChanges: _heightChanges, ...cycle } = result;
      expect.soft(cycle).toEqual({
        words: ["certificates", "check-ins", "sign-ups", "verified hours"],
        heights: 1,
        documents: 1,
        overflow: false,
      });
      expect(faults).toEqual({ page: 0, console: 0, refused: 0 });
    } finally {
      await context.close();
    }
  });
}
