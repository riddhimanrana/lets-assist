import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const certificate = {
  id: "10000000-0000-4000-8000-000000000001",
  project_title: "Fictional community park cleanup",
  creator_name: "Morgan Sample",
  is_certified: true,
  event_start: "2026-11-09T18:00:00Z",
  issued_at: "2026-11-10T18:00:00Z",
  timeZone: "America/Los_Angeles",
  organization_name: "Fictional Volunteer Organization",
  volunteer_name: "Alex Example",
  project_location: "Fictional Community Park",
  durationText: "8 hours",
};

for (const isSelfReported of [true, false]) {
  test(`printed ${isSelfReported ? "self-reported" : "verified"} certificate keeps its footer readable on one Letter page`, async ({
    page,
  }, testInfo) => {
    await page.route("http://127.0.0.1:3000/logo.png", (route) =>
      route.fulfill({
        path: resolve("public/logo.png"),
        contentType: "image/png",
      }),
    );
    await page.setViewportSize({ width: 960, height: 720 });
    await page.emulateMedia({ media: "print" });
    const rendered = spawnSync(
      "bun",
      [
        "--no-env-file",
        "--eval",
        'import { buildCertificatePrintHtml } from "./app/certificates/[id]/_components/PrintCertificate"; process.stdout.write(buildCertificatePrintHtml(JSON.parse(process.env.PRINT_FIXTURE)));',
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          PRINT_FIXTURE: JSON.stringify({ ...certificate, isSelfReported }),
        },
      },
    );
    expect(rendered.status).toBe(0);
    const html = rendered.stdout;
    await page.setContent(
      html.replace('src="/logo.png"', 'src="http://127.0.0.1:3000/logo.png"'),
    );
    const columns = await page
      .locator(".print-footer > div")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: node.clientWidth,
            contentWidth: node.scrollWidth,
          };
        }),
      );
    expect(columns).toHaveLength(3);
    for (let index = 0; index < columns.length; index++) {
      expect(columns[index].contentWidth).toBeLessThanOrEqual(
        columns[index].width + 1,
      );
      if (index)
        expect(
          columns[index].left - columns[index - 1].right,
        ).toBeGreaterThanOrEqual(12);
    }
    if (isSelfReported) {
      await expect(
        page.getByText("Not verified by an organizer.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("OFFICIALLY VERIFIED")).toHaveCount(0);
    }
    const pdf = await page.pdf({
      path: testInfo.outputPath("fictional-certificate.pdf"),
      format: "Letter",
      landscape: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      headerTemplate:
        '<div style="font-size:8px">Fictional certificate print regression</div>',
      footerTemplate:
        '<div style="font-size:8px"><span class="pageNumber"></span>/<span class="totalPages"></span></div>',
    });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
}
