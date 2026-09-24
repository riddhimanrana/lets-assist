import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const posthogInitCalls: unknown[][] = [];

mock.module("posthog-js", () => ({
  default: {
    init: (...args: unknown[]) => {
      posthogInitCalls.push(args);
    },
  },
}));

describe("root theme bootstrap", () => {
  test("applies the theme in the head without waiting for analytics or hydration", () => {
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
    const head = layout.slice(
      layout.indexOf("<head>"),
      layout.indexOf("</head>"),
    );
    expect(head).toContain('id="initial-theme"');
    expect(head).toContain("__html: INITIAL_THEME_SCRIPT");
    expect(instrumentation).not.toContain("applyInitialTheme");
    const analyticsGuardIndex = instrumentation.indexOf("if (posthogToken)");
    const analyticsIndex = instrumentation.indexOf("posthog.init(");
    expect(analyticsGuardIndex).toBeGreaterThan(-1);
    expect(analyticsIndex).toBeGreaterThan(analyticsGuardIndex);
  });

  test("skips PostHog when the public token is absent", async () => {
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

    expect(posthogInitCalls).toHaveLength(0);
  });
});
