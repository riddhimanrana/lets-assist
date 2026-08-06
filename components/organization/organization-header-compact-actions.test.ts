import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./OrganizationHeader.tsx", import.meta.url),
  "utf8",
);

describe("compact organization header actions", () => {
  test("keeps Share a compact action instead of a full-width phone row", () => {
    expect(source).toContain(
      'className={cn(compact ? "w-auto shrink-0" : "w-full sm:w-auto")}',
    );
    expect(source).toContain("onClick={handleShare}");
    // No header action may hardcode a full-width phone row any more.
    expect(source).not.toContain('className="w-full sm:w-auto"');
  });

  test("lays compact header actions out inline on one line rather than stacked", () => {
    expect(source).toContain(
      '? "w-auto shrink-0 flex-row items-center justify-end gap-2"',
    );
    // Actions must never stack into a tall column of their own; the outer row
    // wraps instead so the actions cannot dominate the compact header.
    expect(source).not.toContain(
      '? "w-auto shrink-0 flex-row flex-wrap items-center justify-end gap-2"',
    );
  });

  test("lets the compact row wrap intentionally instead of overflowing", () => {
    expect(source).toContain(
      '? "w-full min-w-0 flex-row flex-wrap items-center justify-between gap-2"',
    );
  });

  test("gives the compact identity the free space and constrains its overflow", () => {
    expect(source).toContain(
      'compact ? "flex min-w-0 grow basis-48 flex-row items-center gap-2.5"',
    );
    expect(source).toContain(
      'compact ? "min-w-0 items-start gap-1 overflow-hidden text-left"',
    );
    expect(source).toContain(
      'compact ? "truncate text-lg md:text-xl" : "text-2xl md:text-3xl"',
    );
    expect(source).toContain(
      'cn("flex items-center gap-2", compact && "min-w-0")',
    );
  });

  test("truncates compact metadata rows so long values cannot widen the header", () => {
    // Both metadata rows are width-constrained in compact mode.
    expect(
      source.match(
        /compact \? "min-w-0 max-w-full" : "justify-center md:justify-start"/g,
      ),
    ).toHaveLength(2);
    // Username and website are the unbounded values, so both truncate.
    expect(source).toContain(
      'cn("text-sm text-muted-foreground font-mono", compact && "truncate")',
    );
    expect(source).toContain('<span className={cn(compact && "truncate")}>');
    expect(source).toContain(
      'cn("flex items-center gap-1", compact && "shrink-0 whitespace-nowrap")',
    );
  });

  test("marks every decorative header icon aria-hidden without changing the layout", () => {
    // Each icon sits beside its own visible text, or is a purely decorative
    // verification mark, so none may contribute a duplicate accessible name.
    for (const icon of [
      '<BadgeCheck className="h-4 w-4 text-primary fill-background" aria-hidden="true" />',
      '<GlobeIcon className={cn("h-3.5 w-3.5", compact && "shrink-0")} aria-hidden="true" />',
      '<UsersIcon className="h-3.5 w-3.5" aria-hidden="true" />',
      '<Share2 className="mr-2 h-4 w-4" aria-hidden="true" />',
      '<UsersIcon className="mr-2 h-4 w-4" aria-hidden="true" />',
      '<Plus className="mr-2 h-4 w-4" aria-hidden="true" />',
    ]) {
      expect(
        source,
        `${icon} should be hidden from assistive technology`,
      ).toContain(icon);
    }
    expect(source).toContain(
      '<BadgeCheck\n                  className="hidden md:block h-6 w-6 text-primary"\n                  aria-hidden="true"\n                />',
    );
  });

  test("leaves no header icon exposed to assistive technology", () => {
    const iconElements =
      source.match(
        /<(BadgeCheck|GlobeIcon|UsersIcon|Share2|Plus)\b[^>]*?\/>/g,
      ) ?? [];
    // Two BadgeCheck marks, two UsersIcon, two Plus, one GlobeIcon, one Share2.
    expect(iconElements).toHaveLength(8);
    for (const element of iconElements) {
      expect(element, `${element} is missing aria-hidden`).toContain(
        'aria-hidden="true"',
      );
    }
  });

  test("preserves generic non-compact header layout", () => {
    expect(source).toContain(
      ': "flex-col gap-6 md:flex-row md:items-start md:justify-between"',
    );
    expect(source).toContain(
      ': "w-full flex-col gap-2 sm:flex-row md:w-auto md:items-center"',
    );
    expect(source).toContain(
      ': "items-center gap-2 text-center md:items-start md:text-left"',
    );
    expect(source).toContain(
      ': "flex flex-col items-center gap-4 md:flex-row md:items-start"',
    );
  });
});
