// Run: bun tests/e2e/signupgenius/import.browser.ts
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import tailwind from "@tailwindcss/postcss";

const build = await Bun.build({
  entrypoints: [new URL("./import.fixture.tsx", import.meta.url).pathname],
  target: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "isolated-navigation",
      setup(builder) {
        builder.onResolve(
          { filter: /^next\/(navigation|link)$/ },
          ({ path }) => ({ path, namespace: "fixture" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          loader: "tsx",
          contents: path.endsWith("navigation")
            ? "export function useRouter(){return {push(url){Object.assign(window,{importDestination:url})}}}"
            : "export default function Link({children,...props}){return <a {...props}>{children}</a>}",
        }));
      },
    },
  ],
});
if (!build.success)
  throw new AggregateError(
    build.logs,
    "Importer browser fixture failed to bundle",
  );
const postcss = createRequire(import.meta.resolve("@tailwindcss/postcss"))(
  "postcss",
);
const css = await postcss([tailwind()]).process(
  await readFile("app/globals.css", "utf8"),
  { from: "app/globals.css" },
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/fixture.js")
      return new Response(build.outputs[0], {
        headers: { "content-type": "text/javascript" },
      });
    if (pathname === "/fixture.css")
      return new Response(css.css, { headers: { "content-type": "text/css" } });
    return new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>',
      { headers: { "content-type": "text/html" } },
    );
  },
});
const base = `http://127.0.0.1:${server.port}`;
const preview = {
  sourceUrl: "https://www.signupgenius.com/go/10C0B4CAEAD2EA6FEC34",
  title: "Fictional park cleanup",
  description: "Bring gloves & water.",
  location: "Fictional park",
  timezone: "America/Los_Angeles",
  slots: [
    {
      name: "Setup crew",
      date: "2025-10-12",
      startTime: "09:00",
      endTime: "11:00",
      capacity: 6,
    },
  ],
};
const artifacts = ".artifacts/signupgenius-import/browser";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium",
});
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== base) return route.abort();
      return route.continue();
    });
    await page.goto(base);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.screenshot({ path: `${artifacts}/initial-${width}.png` });
    await page.route("**/api/import/signupgenius", (route) =>
      route.fulfill({
        status: 422,
        json: {
          error:
            "This signup format is not supported yet. No project has been created.",
        },
      }),
    );
    await page
      .getByLabel("SignUpGenius link", { exact: true })
      .fill(preview.sourceUrl);
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("not supported");
    await expect(page.getByLabel("Project title")).toHaveCount(0);
    await page.unroute("**/api/import/signupgenius");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    await page.route("**/api/import/signupgenius", async (route) => {
      if (++calls === 1) await gate;
      await route
        .fulfill({
          status: 200,
          json: {
            preview: {
              ...preview,
              title: calls === 1 ? "Stale preview" : preview.title,
            },
          },
        })
        .catch(() => {});
    });
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await expect(page.getByLabel("Project title")).toHaveValue(preview.title);
    release();
    await expect(page.getByRole("alert")).toContainText("past dates");
    await page
      .getByLabel("Event timezone", { exact: true })
      .fill("invalid/zone");
    await expect(page.getByLabel("Project title")).toHaveValue(preview.title);
    await page
      .getByLabel("Event timezone", { exact: true })
      .fill("America/Los_Angeles");
    await expect(page.getByLabel("Date", { exact: true })).toHaveValue(
      "2025-10-12",
    );
    await expect(page.getByLabel("Total places", { exact: true })).toHaveValue(
      "6",
    );
    await expect(
      page.getByRole("button", {
        name: "Continue to project review",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByLabel("I am authorized to organize this event", { exact: false })
      .check();
    await page
      .getByRole("button", { name: "Continue to project review", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, "importDestination")))
      .toMatch(/^\/projects\/create\?import=/u);
    const saved = await page.evaluate(() =>
      Object.entries(sessionStorage)
        .filter(([key]) => key.startsWith("lets-assist:signupgenius:"))
        .map(([, value]) => JSON.parse(value)),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].preview.slots[0].date).toBe("2025-10-12");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `${artifacts}/preview-${width}.png`,
      fullPage: true,
    });
    await context.close();
  }
  console.log(
    "PASS: synthetic importer browser flows at 1280, 390 and 320px; unsupported, repeated/canceled requests, historical preview, timezone editing and tab handoff.",
  );
} finally {
  await browser.close();
  server.stop(true);
}
