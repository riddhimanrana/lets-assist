import { expect, test } from "@playwright/test";
import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";

for (const width of [320, 390, 414]) {
  test(`comparison phrase cycle keeps heading and page height at ${width}px`, async ({
    browser,
    baseURL,
  }) => {
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
      await page
        .locator('[data-slot="comparison-word"]')
        .scrollIntoViewIfNeeded();
      const result = await page.evaluate(async () => {
        await document.fonts.ready;
        const frame = document.querySelector('[data-slot="comparison-word"]');
        const heading = frame?.closest("h2");
        if (!frame || !heading)
          throw new Error("Comparison heading is missing.");
        const seen = new Set<string>();
        const heights = new Set<number>();
        const documents = new Set<number>();
        const start = performance.now();
        let overflow = false;
        while (performance.now() - start < 11_500) {
          const word = frame.querySelector('span:not([aria-hidden="true"])');
          if (word && Number(getComputedStyle(word).opacity) > 0.995)
            seen.add(word.textContent?.trim() ?? "");
          heights.add(heading.getBoundingClientRect().height);
          documents.add(document.documentElement.scrollHeight);
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
        };
      });
      expect(result).toEqual({
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
