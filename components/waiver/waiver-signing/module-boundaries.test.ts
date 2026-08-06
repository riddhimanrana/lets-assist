import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const waiverRoot = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(waiverRoot, path), "utf8");

describe("waiver signing module boundaries", () => {
  test("the dialog delegates definition assembly and step presentation", () => {
    const source = read("WaiverSigningDialog.tsx");
    expect(source).toContain("useWaiverSigningDefinition(");
    expect(source).toContain("<WaiverSigningStepsPanel");
    expect(source.split("\n").length).toBeLessThanOrEqual(600);
  });

  test("the shared desktop and mobile step panel stays within budget", () => {
    const source = read("waiver-signing/WaiverSigningStepsPanel.tsx");
    expect(source).toMatch(/^"use client";/);
    expect(source.split("\n").length).toBeLessThanOrEqual(600);
    expect(source).toContain("!isDesktop");
  });
});
