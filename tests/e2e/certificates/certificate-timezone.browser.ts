// Controlled actual-component and print interaction proof, not hosted Next route acceptance.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CertificateDocument } from "../../../app/certificates/[id]/_components/CertificateDocument";
import { certificate } from "./certificate-timezone-data";

const build = await Bun.build({
  entrypoints: [
    new URL("./certificate-timezone.fixture.tsx", import.meta.url).pathname,
  ],
  target: "browser",
  define: { "process.env": '{"NODE_ENV":"production"}' },
});
if (!build.success)
  throw new AggregateError(build.logs, "Certificate fixture build failed");
const postcss = createRequire(import.meta.resolve("@tailwindcss/postcss"))(
  "postcss",
);
const css = await postcss([tailwind()]).process(
  await readFile("app/globals.css", "utf8"),
  { from: "app/globals.css" },
);
const logo = await readFile("public/logo.png");
const documentHtml = renderToStaticMarkup(
  createElement(CertificateDocument, {
    data: certificate,
    durationText: "1 hour",
    isSelfReported: true,
  }),
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
      case "/logo.png":
      case "/_next/image":
        return new Response(logo, { headers: { "content-type": "image/png" } });
      case "/":
        return new Response(
          `<!doctype html><meta charset="utf-8"><title>Certificate timezone regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><main class="mx-auto grid max-w-3xl gap-6 p-6"><h1 class="text-2xl font-semibold">Self-reported certificate</h1>${documentHtml}<div id="root"></div></main><script type="module" src="/fixture.js"></script>`,
          { headers: { "content-type": "text/html" } },
        );
      default:
        return new Response("Refused", { status: 404 });
    }
  },
});
const base = `http://127.0.0.1:${server.port}`;
const evidence = "/tmp/lets-assist-certificate-timezone";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 1050 },
      timezoneId: "America/Los_Angeles",
      serviceWorkers: "block",
    });
    // Keep the real print frame alive for inspection without opening a system print dialog.
    await context.addInitScript(() => {
      window.print = () =>
        Reflect.set(
          window,
          "certificatePrintCalls",
          (Reflect.get(window, "certificatePrintCalls") ?? 0) + 1,
        );
    });
    const page = await context.newPage();
    const errors: string[] = [];
    let refusedRequests = 0;
    page.on("pageerror", (error) => {
      errors.push(error.name);
      console.error("Fixture runtime:", error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push("console-error");
    });
    await context.route("**/*", (route) => {
      const request = route.request();
      if (
        new URL(request.url()).origin !== base ||
        request.method() !== "GET"
      ) {
        refusedRequests++;
        return route.abort();
      }
      return route.continue();
    });
    page.setDefaultTimeout(5000);
    await page.goto(base);
    assert.equal(await page.title(), "Certificate timezone regression");
    assert.equal(page.url(), base + "/");
    await page
      .getByRole("heading", { name: "Self-reported certificate", exact: true })
      .waitFor();
    await page
      .getByText("Oct 13, 2026 • 12:30 AM GMT+9", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByText("Loading...", { exact: true }).count(),
      0,
    );
    assert.equal(await page.getByText(/Oct 12, 2026/).count(), 0);
    await page.screenshot({ path: `${evidence}/certificate-${width}.png` });
    await page
      .getByRole("button", { name: "Print certificate", exact: true })
      .click();
    const frame = page.frameLocator(
      'iframe[title="Certificate print preview"]',
    );
    await frame.getByText("October 13, 2026", { exact: true }).waitFor();
    assert.equal(
      await frame.getByText(/October 12, 2026|Oct 12, 2026/).count(),
      0,
    );
    assert.ok(
      (await frame.locator("body").innerText()).includes(
        "Issued: Oct 13, 2026",
      ),
    );
    await page
      .locator('iframe[title="Certificate print preview"]')
      .evaluate((element) => {
        Object.assign((element as HTMLIFrameElement).style, {
          width: "1000px",
          height: "760px",
          visibility: "visible",
          position: "relative",
        });
      });
    if (width === 1280)
      await frame
        .locator("body")
        .screenshot({ path: `${evidence}/printed-certificate.png` });
    assert.equal(
      await frame
        .locator("body")
        .evaluate(() => Reflect.get(window, "certificatePrintCalls")),
      1,
    );
    await page
      .locator('iframe[title="Certificate print preview"]')
      .evaluate((element) => {
        (element as HTMLIFrameElement).contentWindow!.dispatchEvent(
          new Event("afterprint"),
        );
      });
    assert.equal(
      await page.locator('iframe[title="Certificate print preview"]').count(),
      0,
    );
    await page
      .getByRole("button", { name: "Print all certificates", exact: true })
      .click();
    await page.locator("#print-container").waitFor({ state: "attached" });
    const printed = await page.locator("#print-container").innerText();
    assert.ok(printed.includes("Oct 13, 2026 GMT+9"));
    assert.ok(!printed.includes("Oct 12, 2026"));
    assert.deepEqual(errors, []);
    assert.equal(refusedRequests, 0);
    console.log(
      JSON.stringify({
        width,
        viewerZone: "America/Los_Angeles",
        recordedZone: "Asia/Tokyo",
        document: "passed",
        individualPrint: "passed",
        bulkPrint: "passed",
        errors: 0,
        refusedRequests,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.stop(true);
}
