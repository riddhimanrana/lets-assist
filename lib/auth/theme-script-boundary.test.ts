import { describe, expect, test } from "bun:test";
import ts from "typescript";
import * as privacy from "../analytics-privacy";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  });

  test("actual initialization respects token, Production, browser and host gates", () => {
    const source = readFileSync(
      join(process.cwd(), "instrumentation-client.ts"),
      "utf8",
    );
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    for (const scenario of [
      {
        token: undefined,
        node: "production",
        hosted: "production",
        hostname: "lets-assist.com",
        expected: 0,
      },
      {
        token: "synthetic",
        node: "development",
        hosted: "production",
        hostname: "lets-assist.com",
        expected: 0,
      },
      {
        token: "synthetic",
        node: "production",
        hosted: "preview",
        hostname: "lets-assist.com",
        expected: 0,
      },
      {
        token: "synthetic",
        node: "production",
        hosted: "production",
        hostname: "localhost",
        expected: 0,
      },
      {
        token: "synthetic",
        node: "production",
        hosted: "production",
        hostname: undefined,
        expected: 0,
      },
      {
        token: "synthetic",
        node: "production",
        hosted: "production",
        hostname: "lets-assist.com",
        expected: 1,
      },
    ]) {
      const calls: unknown[][] = [];
      const require = (name: string) => {
        if (name === "posthog-js")
          return {
            __esModule: true,
            default: { init: (...args: unknown[]) => calls.push(args) },
          };
        if (name === "./lib/analytics-privacy") return privacy;
        throw new Error("Unreviewed client bootstrap dependency");
      };
      new Function("require", "exports", "process", "window", output)(
        require,
        {},
        {
          env: {
            NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: scenario.token,
            NODE_ENV: scenario.node,
            NEXT_PUBLIC_VERCEL_ENV: scenario.hosted,
          },
        },
        scenario.hostname
          ? { location: { hostname: scenario.hostname, protocol: "https:" } }
          : undefined,
      );
      expect(calls).toHaveLength(scenario.expected);
      if (scenario.expected)
        expect(calls[0][1]).toMatchObject({
          autocapture: false,
          capture_exceptions: false,
          disable_session_recording: true,
        });
    }
  });
});
