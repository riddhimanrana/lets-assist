import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./OrganizationTabs.tsx", import.meta.url),
  "utf8",
);

describe("compact organization navigation on phones", () => {
  test("keeps overflowed primary destinations reachable from More", () => {
    expect(source).toContain(
      "const compactMobileOverflowTabs = pluginNavigationOverrides.compactHeader",
    );
    expect(source).toContain(
      'index >= 2 && pluginNavigationOverrides.compactHeader && "hidden sm:flex"',
    );
    expect(source).toContain("compactMobileOverflowTabs.map((pt) => (");
    expect(source).toContain('className="justify-between sm:hidden"');
  });

  test("does not add a desktop More button when it only contains mobile overflow", () => {
    expect(source).toContain(
      'className={cn("shrink-0", morePluginTabs.length === 0 && "sm:hidden")}',
    );
  });
});
