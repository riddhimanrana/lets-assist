import { expect, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { AxeResults, Result } from "axe-core";

// Inject the exact prebuilt browser bundle that ships with the pinned
// axe-core version instead of re-bundling the npm entry point.
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

type AxeRunner = {
  run: (
    context: Document,
    options: { resultTypes: string[] },
  ) => Promise<AxeResults>;
};

function describeViolation(violation: Result) {
  const targets = violation.nodes
    .map((node) => node.target.join(" "))
    .join("; ");
  return `${violation.id}: ${violation.help} — ${targets}`;
}

/**
 * Runs the complete default axe-core ruleset on the current document and
 * fails when any violation carries exactly "critical" impact. No rule is
 * excluded or downgraded; every violation of every impact is attached to the
 * test report so lower-impact findings stay reviewable without weakening the
 * gate.
 */
export async function expectNoCriticalAxeViolations(
  page: Page,
  testInfo: TestInfo,
  label: string,
) {
  if (!(await page.evaluate(() => "axe" in window))) {
    await page.addScriptTag({ content: axeSource });
  }
  const results = await page.evaluate(() =>
    (window as unknown as { axe: AxeRunner }).axe.run(document, {
      resultTypes: ["violations"],
    }),
  );
  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(
      { url: page.url(), violations: results.violations },
      null,
      2,
    ),
    contentType: "application/json",
  });
  const critical = results.violations.filter(
    (violation) => violation.impact === "critical",
  );
  expect(
    critical.map(describeViolation),
    `Critical axe violations on ${label}`,
  ).toEqual([]);
}
