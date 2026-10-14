import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { getCsfIsolatedSupabaseEnv } from "../../../scripts/local-dev/dv-local-env.mjs";
import { readAxeRows } from "../../../scripts/local-dev/layout-audit/axe-color-diagnostics.mjs";

const sections = ["journey", "org-tooling", "check-in", "partners", "cta"];
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

for (const width of [320, 390, 414]) {
  test(`public landing keeps its sections and page height at ${width}px`, async ({
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
      const response = await page.goto(`${baseURL}/?noRedirect=1`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "A workspace for your volunteer organization.",
        }),
      ).toBeVisible();
      for (const id of sections) {
        const section = page.locator(`#${id}`);
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
      }
      await expect(
        page.locator("#org-tooling .relative.mx-auto.mt-12.w-full.max-w-6xl"),
      ).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
      if (width === 390) {
        await page.addScriptTag({ content: axeSource });
        const axeRows = (await page.evaluate(readAxeRows, {
          includeColorDetails: true,
        })) as { id: string }[];
        expect(axeRows.filter((row) => row.id === "color-contrast")).toEqual(
          [],
        );
      }
      const samples: Array<{
        height: number;
        overflow: boolean;
        sectionTops: number[];
      }> = [];
      for (let i = 0; i < 4; i++) {
        await page.waitForTimeout(250);
        samples.push(
          await page.evaluate(
            (ids) => ({
              height: document.documentElement.scrollHeight,
              overflow:
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth + 1,
              sectionTops: ids.map((id) => {
                const element = document.getElementById(id);
                if (!element)
                  throw new Error("Reviewed landing section missing.");
                return Math.round(
                  element.getBoundingClientRect().top + scrollY,
                );
              }),
            }),
            sections,
          ),
        );
      }
      await testInfo.attach("landing-layout-dimensions", {
        contentType: "application/json",
        body: JSON.stringify({ width, samples, faults }),
      });
      expect(samples.every((sample) => sample.height > 900)).toBe(true);
      expect(new Set(samples.map((sample) => sample.height)).size).toBe(1);
      for (const sample of samples) {
        expect(sample.overflow).toBe(false);
        expect(sample.sectionTops).toEqual(
          [...sample.sectionTops].sort((a, b) => a - b),
        );
        expect(new Set(sample.sectionTops).size).toBe(sections.length);
      }
      expect(faults).toEqual({ page: 0, console: 0, refused: 0 });
    } finally {
      await context.close();
    }
  });
}
