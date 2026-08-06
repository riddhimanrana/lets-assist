import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const layoutRoot = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(layoutRoot, path), "utf8");

describe("navbar module boundaries", () => {
  test("the shell delegates desktop navigation, theme, and preview state", () => {
    const source = read("Navbar.tsx");
    expect(source).toContain("<DesktopPrimaryNavigation");
    expect(source).toContain("<NavbarThemeSelector");
    expect(source).toContain("useDevPreviewSource()");
    expect(source.split("\n").length).toBeLessThanOrEqual(600);
  });

  test("interactive navbar modules remain client components", () => {
    for (const path of [
      "Navbar.tsx",
      "navbar/NavbarThemeSelector.tsx",
      "navbar/useDevPreviewSource.ts",
    ]) {
      expect(read(path)).toMatch(/^"use client";|^\/\/[^\n]+\n"use client";/);
    }
  });
});
