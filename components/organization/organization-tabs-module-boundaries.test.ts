import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) =>
  readFileSync(join(import.meta.dir, path), "utf8");

describe("organization tabs module boundaries", () => {
  test("the controller delegates navigation and overview presentation", () => {
    const source = read("OrganizationTabs.tsx");
    expect(source).toContain("<OrganizationTabsNavigation");
    expect(source).toContain("<OrganizationOverviewTab");
    expect(source.split("\n").length).toBeLessThanOrEqual(600);
  });

  test("each extracted client module stays within the component budget", () => {
    for (const path of [
      "OrganizationOverviewTab.tsx",
      "OrganizationTabsNavigation.tsx",
      "LeaveOrganizationDialog.tsx",
    ]) {
      const source = read(path);
      expect(source).toMatch(/^"use client";/);
      expect(source.split("\n").length).toBeLessThanOrEqual(600);
    }
  });
});
