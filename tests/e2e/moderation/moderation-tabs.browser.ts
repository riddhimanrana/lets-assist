// Standalone controlled component regression: bun tests/e2e/moderation/moderation-tabs.browser.ts.
// Real React, Base UI and app CSS; only the organization read is fictional.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const build = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "moderation-tabs.fixture.tsx")],
  target: "browser",
  define: { "process.env": '{"NODE_ENV":"production"}' },
  plugins: [
    {
      name: "fictional-moderation-read",
      setup(builder) {
        builder.onResolve({ filter: /^\.\/actions$/ }, (args) =>
          args.importer.endsWith("/moderation/OrgModerationDashboard.tsx")
            ? { path: "moderation-read", namespace: "fictional" }
            : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: "fictional" }, () => ({
          loader: "js",
          contents: `export async function getOrgFlaggedContent(organizationId, status) {
          const calls = Reflect.get(globalThis, "moderationReadCalls") ?? [];
          calls.push({ organizationId, status });
          Reflect.set(globalThis, "moderationReadCalls", calls);
          return { data: [] };
        }`,
        }));
      },
    },
  ],
});
if (!build.success)
  throw new AggregateError(build.logs, "Moderation fixture build failed");
// Resolve the PostCSS instance used by Tailwind, as in the feedback browser harness.
const postcss = createRequire(import.meta.resolve("@tailwindcss/postcss"))(
  "postcss",
);
const css = await postcss([tailwind()]).process(
  await readFile("app/globals.css", "utf8"),
  { from: "app/globals.css" },
);
const font = await readFile(
  "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (request.method !== "GET")
      return new Response("Refused", { status: 405 });
    switch (new URL(request.url).pathname) {
      case "/fixture.js":
        return new Response(build.outputs[0], {
          headers: { "content-type": "text/javascript" },
        });
      case "/fixture.css":
        return new Response(css.css, {
          headers: { "content-type": "text/css" },
        });
      case "/geist.woff2":
        return new Response(font, {
          headers: { "content-type": "font/woff2" },
        });
      case "/":
        return new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>@font-face{font-family:Geist;src:url(/geist.woff2)}body{font-family:Geist;--font-geist-sans:Geist}</style><div id="root"></div><script type="module" src="/fixture.js"></script>',
          { headers: { "content-type": "text/html" } },
        );
      default:
        return new Response("Refused", { status: 404 });
    }
  },
});
const base = `http://127.0.0.1:${server.port}`;
const artifacts = ".artifacts/moderation-tabs-browser";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const results = [];
try {
  for (const width of [320, 390, 640, 1280])
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: dark ? "dark" : "light",
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      let blockedRequests = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", (route) => {
        if (
          new URL(route.request().url()).origin !== base ||
          route.request().method() !== "GET"
        ) {
          blockedRequests++;
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(base);
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle("dark", dark),
        dark,
      );
      await page.evaluate(() => document.fonts.ready);
      const list = page.getByRole("tablist", {
        name: "Content status",
        exact: true,
      });
      await list.waitFor();
      await list.scrollIntoViewIfNeeded();
      const metrics = await list.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const clipTop = box.top + el.clientTop,
          clipBottom = clipTop + el.clientHeight;
        return {
          height: box.height,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          scrollTop: el.scrollTop,
          display: style.display,
          tabs: [...el.querySelectorAll<HTMLElement>('[role="tab"]')].map(
            (tab) => {
              const rect = tab.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(tab);
              const text = range.getBoundingClientRect();
              const hit = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              );
              return {
                name: tab.textContent?.trim(),
                top: rect.top,
                height: rect.height,
                contained: rect.top >= clipTop && rect.bottom <= clipBottom,
                textContained: text.top >= clipTop && text.bottom <= clipBottom,
                centerHit: hit === tab || (hit !== null && tab.contains(hit)),
                fitsPage: rect.left >= 0 && rect.right <= innerWidth,
              };
            },
          ),
        };
      });
      assert.equal(metrics.tabs.length, 4);
      assert.ok(
        metrics.scrollHeight <= metrics.clientHeight + 1,
        `Clipped tab grid at ${width}px: ${JSON.stringify(metrics)}`,
      );
      assert.equal(metrics.scrollTop, 0);
      const rows = new Set(metrics.tabs.map((tab) => Math.round(tab.top)));
      assert.equal(rows.size, width < 640 ? 2 : 1);
      if (width >= 640)
        assert.equal(
          metrics.height,
          36,
          "Desktop keeps the single-row tab height",
        );
      for (const tab of metrics.tabs) {
        assert.ok(
          tab.contained && tab.textContained && tab.centerHit && tab.fitsPage,
          `Tab obscured: ${JSON.stringify(tab)}`,
        );
        assert.ok(
          tab.height >= 24,
          "A usable tab target needs its full row height",
        );
      }
      for (const name of [
        "Pending (0)",
        "Blocked (0)",
        "Confirmed",
        "Dismissed",
      ]) {
        const tab = list.getByRole("tab", { name, exact: true });
        await tab.click();
        assert.equal(await tab.getAttribute("aria-selected"), "true");
        assert.equal(
          await list.evaluate((el) => el.scrollTop),
          0,
          "Clicking must not scroll hidden rows into view",
        );
      }
      const reads = await page.evaluate(() =>
        Reflect.get(globalThis, "moderationReadCalls"),
      );
      assert.deepEqual(
        reads,
        ["blocked", "confirmed", "dismissed"].map((status) => ({
          organizationId: "fictional-moderation-organization",
          status,
        })),
      );
      assert.deepEqual(errors, []);
      assert.equal(blockedRequests, 0);
      await page.screenshot({
        path: `${artifacts}/tabs-${width}-${dark ? "dark" : "light"}.png`,
        fullPage: true,
      });
      results.push({
        width,
        theme: dark ? "dark" : "light",
        metrics,
        reads,
        errors,
        blockedRequests,
      });
      await context.close();
    }
  await writeFile(
    `${artifacts}/metrics.json`,
    JSON.stringify(
      {
        scope:
          "controlled actual component/CSS, fictional read; not native authenticated route acceptance",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `All four tab labels and clicks pass in ${results.length} viewport/theme renders.`,
  );
} finally {
  await browser.close();
  server.stop(true);
}
