import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { needsIsolatedProcess } from "./test-isolation.mjs";

describe("test isolation classifier", () => {
  test("module mocks need their own process", () => {
    expect(needsIsolatedProcess('mock.module("x", () => ({}));')).toBe(true);
    expect(needsIsolatedProcess("mock . module ( 'x' )")).toBe(true);
  });

  test("an actual minimal DOM install needs its own process", () => {
    expect(
      needsIsolatedProcess("const { document } = installMinimalDom();"),
    ).toBe(true);
    expect(needsIsolatedProcess("  installMinimalDom();")).toBe(true);
  });

  test("importing, naming or commenting on the helper does not", () => {
    expect(
      needsIsolatedProcess(
        'import { installMinimalDom } from "@/tests/support/minimal-dom";',
      ),
    ).toBe(false);
    expect(needsIsolatedProcess("// call installMinimalDom() first")).toBe(
      false,
    );
    expect(needsIsolatedProcess(" * installMinimalDom() puts window on")).toBe(
      false,
    );
    expect(needsIsolatedProcess('const s = "installMinimalDom()";')).toBe(
      false,
    );
  });

  test("ordinary tests share a process", () => {
    expect(
      needsIsolatedProcess(
        'import { test } from "bun:test";\ntest("x", () => {});',
      ),
    ).toBe(false);
  });

  test("every current minimal DOM lifecycle test is classified as isolated", () => {
    for (const file of [
      "app/projects/create/AIAssistant.lifecycle.test.tsx",
      "app/projects/create/use-draft-autosave.lifecycle.test.tsx",
      "components/projects/ProjectFeedbackForm.lifecycle.test.tsx",
    ]) {
      expect(needsIsolatedProcess(readFileSync(file, "utf8")), file).toBe(true);
    }
    // The helper defines the function; it is not a test file and installs
    // nothing when imported.
    expect(
      needsIsolatedProcess(
        readFileSync("tests/support/minimal-dom.ts", "utf8"),
      ),
    ).toBe(false);
  });

  test("the root runner uses this classifier", () => {
    const runner = readFileSync("scripts/run-tests.mjs", "utf8");
    expect(runner).toContain(
      'import { needsIsolatedProcess } from "./ci/test-isolation.mjs";',
    );
    expect(runner).toContain(
      'return needsIsolatedProcess(readFileSync(file, "utf8"));',
    );
  });
});
