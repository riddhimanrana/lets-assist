import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("root theme bootstrap", () => {
  test("runs before hydration without rendering a script in the React tree", () => {
    const layout = readFileSync(
      join(process.cwd(), "app", "layout.tsx"),
      "utf8",
    );
    const instrumentation = readFileSync(
      join(process.cwd(), "instrumentation-client.ts"),
      "utf8",
    );

    expect(layout).not.toContain('from "next/script"');
    expect(layout).not.toContain("<Script");
    expect(layout).not.toMatch(/<script\b/);
    expect(instrumentation).toContain('import { applyInitialTheme }');
    expect(instrumentation).toContain("applyInitialTheme();");

    const themeIndex = instrumentation.indexOf("applyInitialTheme();");
    const analyticsIndex = instrumentation.indexOf("posthog.init(");
    expect(themeIndex).toBeGreaterThan(-1);
    expect(themeIndex).toBeLessThan(analyticsIndex);
  });
});
