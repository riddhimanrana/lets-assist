import { chromium, expect } from "@playwright/test";

const build = await Bun.build({
  entrypoints: [
    new URL(
      "../../lib/plugins/private/plugins/dvhs-csf/tests/browser/attendance-match-options.fixture.tsx",
      import.meta.url,
    ).pathname,
  ],
  target: "browser",
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
});
if (!build.success)
  throw new AggregateError(build.logs, "Fixture build failed");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({
    content: await build.outputs[0].text(),
    type: "module",
  });
  const picker = page.getByLabel("Student", { exact: true });
  const reason = page.getByLabel("How did you identify this student?", {
    exact: true,
  });
  const selected = page.locator('input[name="profileId"]');
  const evidence = "Reviewed the original timestamp and school email.";

  await picker.click();
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(
    page.getByText("No students found.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Search students" }).press("Escape");
  await reason.fill(evidence);
  await page
    .getByRole("button", { name: "Return attendance search", exact: true })
    .click();
  await picker.click();
  await page.getByRole("option", { name: "Alex Example", exact: true }).click();
  await expect(selected).toHaveValue("member-a");

  await page
    .getByRole("button", { name: "Refresh attendance search", exact: true })
    .click();
  await picker.click();
  await expect(
    page.getByRole("option", { name: "Jordan Example", exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Search students" }).press("Escape");
  await expect(picker).toHaveText("Alex Example");
  await expect(selected).toHaveValue("member-a");
  await expect(reason).toHaveValue(evidence);

  await page.getByRole("button", { name: "Match", exact: true }).click();
  await expect(
    page.getByText("Fixture leaves the review open.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Submitted match")).toHaveText(
    `member-a: ${evidence}`,
  );
  await expect(selected).toHaveValue("member-a");
  await expect(reason).toHaveValue(evidence);
  console.log(
    "PASS: refreshed attendance results preserve the selected student and evidence through a refused match.",
  );
} finally {
  await browser.close();
}
