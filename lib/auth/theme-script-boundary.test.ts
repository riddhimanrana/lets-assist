import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const posthogInitCalls: unknown[][] = [];
let themeApplyCalls = 0;

mock.module("posthog-js", () => ({
  default: {
    init: (...args: unknown[]) => {
      posthogInitCalls.push(args);
    },
  },
}));
mock.module("@/lib/theme/apply-initial-theme", () => ({
  applyInitialTheme: () => {
    themeApplyCalls += 1;
  },
}));

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
    expect(instrumentation).toContain("import { applyInitialTheme }");
    expect(instrumentation).toContain("applyInitialTheme();");

    const themeIndex = instrumentation.indexOf("applyInitialTheme();");
    const analyticsGuardIndex = instrumentation.indexOf("if (posthogToken)");
    const analyticsIndex = instrumentation.indexOf("posthog.init(");
    expect(themeIndex).toBeGreaterThan(-1);
    expect(analyticsGuardIndex).toBeGreaterThan(themeIndex);
    expect(analyticsIndex).toBeGreaterThan(analyticsGuardIndex);
    expect(themeIndex).toBeLessThan(analyticsIndex);
  });

  test("applies the theme but skips PostHog when the public token is absent", async () => {
    const previousToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

    try {
      await import("../../instrumentation-client");
    } finally {
      if (previousToken === undefined) {
        delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
      } else {
        process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = previousToken;
      }
    }

    expect(themeApplyCalls).toBe(1);
    expect(posthogInitCalls).toHaveLength(0);
  });
});
