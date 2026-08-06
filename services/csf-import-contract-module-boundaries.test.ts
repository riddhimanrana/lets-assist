import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("CSF normalized import contract modules", () => {
  test("the established module exports only the contract surface", () => {
    const barrel = read("services/csf-import-contract.ts");
    expect(barrel).toContain("buildCsfNormalizedImportSnapshot");
    expect(barrel).not.toContain("sanitizeObject,");
    expect(barrel).not.toContain("validateSourceEvidence,");
  });

  test("canonicalization, sanitization, and assembly meet the budget", () => {
    for (const path of [
      "services/csf-import-contract-core.ts",
      "services/csf-import-contract-sanitize.ts",
      "services/csf-import-contract-build.ts",
    ]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });
});
