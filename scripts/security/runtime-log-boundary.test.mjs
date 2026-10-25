import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const lint = new ESLint();
describe("runtime logging source boundary", () => {
  test("the application config refuses direct, aliased and global console access", async () => {
    for (const source of [
      'console.error("private");',
      'console["error"]("private");',
      'const output = console.error; output("private");',
      'const { error: output } = console; output("private");',
      'globalThis.console.error("private");',
      'window.console.error("private");',
    ]) {
      const [result] = await lint.lintText(source, {
        filePath: "app/logging-boundary-fixture.ts",
      });
      expect(
        result.messages.some((issue) =>
          [
            "no-console",
            "no-restricted-globals",
            "no-restricted-properties",
          ].includes(issue.ruleId),
        ),
      ).toBe(true);
    }
  });
  test("the privacy sink and tests can capture native console, but ordinary runtime cannot", async () => {
    const source = 'console.error("fixture");';
    for (const filePath of [
      "lib/safe-console.ts",
      "lib/privacy-fixture.test.ts",
    ]) {
      const [result] = await lint.lintText(source, { filePath });
      expect(
        result.messages.filter((issue) =>
          ["no-console", "no-restricted-globals"].includes(issue.ruleId),
        ),
      ).toHaveLength(0);
    }
    const [result] = await lint.lintText(
      'import { safeConsole } from "@/lib/safe-console"; safeConsole.error("Error fetching profile:");',
      { filePath: "hooks/privacy-fixture.ts" },
    );
    expect(result.errorCount).toBe(0);
  });
});
