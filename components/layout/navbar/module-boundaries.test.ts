import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const layoutRoot = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(layoutRoot, path), "utf8");

describe("navbar module boundaries", () => {
  test("the shell delegates navigation, account controls, and preview state", () => {
    const source = read("Navbar.tsx");
    expect(source).toContain("<DesktopPrimaryNavigation");
    expect(source).toContain("<MobileNavigation");
    expect(source).toContain("<AccountMenu");
    expect(source).toContain("<NavbarThemeMenu");
    expect(source).toContain("useDevPreviewSource()");
    expect(source.split("\n").length).toBeLessThanOrEqual(600);
  });

  test("both account surfaces keep the theme selector and the preview switch", () => {
    for (const path of [
      "navbar/AccountMenu.tsx",
      "navbar/MobileNavigation.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("<NavbarThemeSelector");
      expect(source).toContain("<DevPreviewSourceSwitch");
      expect(source.split("\n").length).toBeLessThanOrEqual(600);
    }
  });

  test("desktop and mobile share one list of destinations", () => {
    for (const path of [
      "navbar/DesktopPrimaryNavigation.tsx",
      "navbar/MobileNavigation.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("memberLinks");
      expect(source).toContain("publicLinks");
      expect(source).toContain("featureLinks");
    }
  });

  test("interactive navbar modules remain client components", () => {
    for (const path of [
      "Navbar.tsx",
      "navbar/AccountMenu.tsx",
      "navbar/MobileNavigation.tsx",
      "navbar/NavbarThemeMenu.tsx",
      "navbar/NavbarThemeSelector.tsx",
      "navbar/DevPreviewSourceSwitch.tsx",
      "navbar/useDevPreviewSource.ts",
    ]) {
      expect(read(path)).toMatch(/^"use client";|^\/\/[^\n]+\n"use client";/);
    }
  });
});
