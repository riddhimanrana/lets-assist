import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const waiverRoot = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(waiverRoot, path), "utf8");

describe("waiver builder module boundaries", () => {
  test("the established component keeps its public type export and delegates panels", () => {
    const source = read("WaiverBuilderDialog.tsx");
    expect(source).toContain("export type { WaiverDefinitionInput }");
    expect(source).toContain("<WaiverBuilderPdfPanel");
    expect(source).toContain("<WaiverBuilderSidebar");
    expect(source.split("\n").length).toBeLessThanOrEqual(600);
  });

  test("every extracted component remains within the component budget", () => {
    for (const path of [
      "waiver-builder/WaiverBuilderPdfPanel.tsx",
      "waiver-builder/WaiverBuilderSidebar.tsx",
    ]) {
      const source = read(path);
      expect(source).toMatch(/^"use client";/);
      expect(source.split("\n").length).toBeLessThanOrEqual(600);
    }
  });
});
