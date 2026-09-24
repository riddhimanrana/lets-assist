import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import tailwind from "@tailwindcss/postcss";
const postcss = createRequire(import.meta.resolve("@tailwindcss/postcss"))(
  "postcss",
);
const build = await Bun.build({
  entrypoints: [new URL("./experience.fixture.tsx", import.meta.url).pathname],
  target: "browser",
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
  plugins: [
    {
      name: "feedback-actions",
      setup(builder) {
        builder.onLoad(
          { filter: /server\/actions\/experience-feedback.ts$/ },
          () => ({
            contents: `export async function consumeCsfExperiencePromptAction(){if(location.search.includes('scope-swap'))await new Promise(resolve=>globalThis.releaseExperiencePrompt=resolve);const old=sessionStorage.getItem('consumed');sessionStorage.setItem('consumed','yes');return {show:!old}} export async function saveCsfExperienceFeedbackAction(){return {success:true}}`,
            loader: "js",
          }),
        );
      },
    },
  ],
});
if (!build.success)
  throw new AggregateError(build.logs, "Feedback fixture build failed");
const css = await postcss([tailwind()]).process(
  await readFile("app/globals.css", "utf8"),
  { from: "app/globals.css" },
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js")
      return new Response(build.outputs[0], {
        headers: { "content-type": "text/javascript" },
      });
    if (path === "/fixture.css")
      return new Response(css.css, { headers: { "content-type": "text/css" } });
    return new Response(
      '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script>globalThis.process={env:{NODE_ENV:"development"}}</script><script type="module" src="/fixture.js"></script>',
      { headers: { "content-type": "text/html" } },
    );
  },
});
const artifacts = ".artifacts/csf-experience/feedback-browser";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const base = `http://127.0.0.1:${server.port}`;
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await page.getByRole("radio", { name: "1 star", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(
      await page.evaluate(() => Reflect.get(globalThis, "experienceCalls")),
    ).toEqual([]);
    await page.keyboard.press("Enter");
    await expect(page.getByText("Saving rating")).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "3 stars", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page
      .getByRole("textbox")
      .fill("The proof preview made submission easy.");
    await page.getByRole("button", { name: "Send comment" }).click();
    await expect(page.getByText("Comment saved. Thank you.")).toBeVisible();
    await page.getByRole("radio", { name: "5 stars", exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "5 stars", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("textbox")).toHaveValue(
      "The proof preview made submission easy.",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: `${artifacts}/rating-${width}.png` });
    expect(errors).toEqual([]);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
  await page.goto(`${base}/?fail=rating`);
  await page.getByRole("radio", { name: "4 stars", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry rating" }).click();
  await expect(page.getByRole("textbox")).toBeVisible();
  await page.goto(`${base}/?fail=comment`);
  await page.getByRole("radio", { name: "4 stars", exact: true }).click();
  await page
    .getByRole("textbox")
    .fill("Keep this draft when the connection fails.");
  await page.getByRole("button", { name: "Send comment" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue(
    "Keep this draft when the connection fails.",
  );
  await expect(
    page.getByRole("radio", { name: "4 stars", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Retry comment" }).click();
  await expect(page.getByText("Comment saved. Thank you.")).toBeVisible();
  await page.goto(`${base}/?prompt&ineligible`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(`${base}/?prompt`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("[data-csf-celebration]")).toHaveCount(1);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const stale = await browser.newPage();
  await stale.goto(`${base}/?prompt&scope-swap`);
  await expect
    .poll(() =>
      stale.evaluate(
        () => typeof Reflect.get(globalThis, "releaseExperiencePrompt"),
      ),
    )
    .toBe("function");
  await stale.getByRole("button", { name: "Switch scope" }).click();
  await stale.evaluate(() =>
    Reflect.get(globalThis, "releaseExperiencePrompt")(),
  );
  await expect(stale.getByRole("dialog")).toHaveCount(0);
  await expect(stale.locator("[data-csf-celebration]")).toHaveCount(0);
  const reduced = await browser.newPage({
    reducedMotion: "reduce",
    viewport: { width: 320, height: 800 },
  });
  await reduced.goto(`${base}/?prompt`);
  await expect(reduced.getByRole("dialog")).toBeVisible();
  await expect(reduced.locator("[data-csf-celebration]")).toHaveCount(0);
  expect(
    await reduced.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await reduced.screenshot({ path: `${artifacts}/prompt-320.png` });
  console.log(
    "Feedback browser checks passed at 1280, 390 and 320 pixels, including keyboard, retries, dismissal and reduced motion.",
  );
} finally {
  await browser.close();
  server.stop(true);
}
