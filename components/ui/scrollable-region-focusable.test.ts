import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regressions the synthetic CSF lifecycle atlas caught in shared primitives:
 *
 * - axe `scrollable-region-focusable` (serious) on
 *   `div[data-slot="table-container"]`. The shared table wrapper scrolls
 *   horizontally, and a read-only table such as the change-history log holds
 *   nothing focusable, so keyboard users could not reach the scroll region.
 * - a phone-width horizontal overflow on the Imports tab. The accordion trigger
 *   is a `flex-1` flex item, so its automatic minimum size pinned it to the
 *   min-content width of a `truncate` (white-space: nowrap) summary line, and
 *   it widened the document instead of ellipsising.
 */

function readComponent(fileName: string) {
  return readFileSync(join(import.meta.dir, fileName), "utf8");
}

function expectAllContained(source: string, fragments: string[]) {
  for (const fragment of fragments) {
    expect(source, `missing source fragment: ${fragment}`).toContain(fragment);
  }
}

describe("shared table scroll container", () => {
  const source = readComponent("table.tsx");

  test("still scrolls horizontally", () => {
    expectAllContained(source, [
      'data-slot="table-container"',
      "overflow-x-auto",
    ]);
  });

  test("only takes a tab stop when nothing inside is focusable", () => {
    expectAllContained(source, [
      "tabIndex={needsTabStop ? 0 : undefined}",
      "container.querySelector(FOCUSABLE_TABLE_CONTENT_SELECTOR) === null",
    ]);
  });

  test("recognises interactive content that already provides a way in", () => {
    const selector = source.match(
      /FOCUSABLE_TABLE_CONTENT_SELECTOR\s*=\s*'([^']+)'/u,
    )?.[1];
    expect(selector, "missing focusable-content selector").toBeDefined();
    expectAllContained(selector ?? "", [
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
      '[tabindex]:not([tabindex="-1"])',
    ]);
  });

  test("gives the new tab stop a visible focus treatment", () => {
    expectAllContained(source, [
      "focus-visible:ring-ring/50",
      "focus-visible:border-ring",
      "focus-visible:ring-[3px]",
    ]);
  });

  test("reuses the table's own accessible name rather than naming nothing", () => {
    expectAllContained(source, [
      'const label = props["aria-label"];',
      'const labelledBy = props["aria-labelledby"];',
      "const named = needsTabStop && Boolean(label || labelledBy);",
      'role={named ? "group" : undefined}',
      "aria-label={named ? label : undefined}",
      "aria-labelledby={named ? labelledBy : undefined}",
    ]);
  });
});

describe("accordion trigger intrinsic width", () => {
  const source = readComponent("accordion.tsx");

  test("the header and the flex-1 trigger can both shrink below content", () => {
    expectAllContained(source, [
      '<AccordionPrimitive.Header className="flex min-w-0">',
      "relative flex min-w-0 flex-1 items-start",
    ]);
  });
});
