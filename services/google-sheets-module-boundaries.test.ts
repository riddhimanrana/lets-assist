import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Google Sheets service modules", () => {
  test("the established module remains a compatibility barrel", () => {
    const barrel = read("services/google-sheets.ts");
    expect(barrel).toContain('export * from "./google-drive";');
    expect(barrel).toContain('export * from "./google-sheets-report";');
    expect(barrel).toContain('export * from "./google-sheets-csf";');
    expect(barrel).toContain('export * from "./google-sheets-fencing";');
  });

  test("Drive, reporting, snapshot, and fencing modules meet the budget", () => {
    for (const path of [
      "services/google-drive.ts",
      "services/google-sheets-report.ts",
      "services/google-sheets-csf.ts",
      "services/google-sheets-fencing.ts",
    ]) {
      expect(read(path).split("\n").length).toBeLessThanOrEqual(800);
    }
  });
});
