import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The import boundary that keeps production buildable.
 *
 * `lib/logger.ts` once imported `loggerProvider` straight from
 * `instrumentation.node.ts`. That bypassed the `NEXT_RUNTIME === "nodejs"`
 * guard in `instrumentation.ts`, so every route that logged also pulled
 * `@opentelemetry/sdk-node` and through it `@grpc/grpc-js`. Turbopack follows a
 * dynamic import when it traces the module graph, reached the Node builtins
 * gRPC requires (`async_hooks`, `dns`, `fs`), and failed with 25
 * module-not-found errors. Every `main` and `development` build broke, and the
 * failure only ever surfaced during a full deployment build.
 *
 * These assertions read the sources rather than importing them, because the
 * defect is a property of the import graph and not of anything the modules do
 * at runtime.
 */

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const loggerSource = read("lib/logger.ts");
const providerSource = read("lib/otel-logger-provider.ts");
const instrumentationNodeSource = read("instrumentation.node.ts");

/** Static `import ... from "x"` specifiers only; `import("x")` is deliberately excluded. */
function staticImportSpecifiers(source: string): string[] {
  return [...source.matchAll(/^\s*import\s[^;]*?from\s*"([^"]+)"/gmu)].map(
    (match) => match[1],
  );
}

describe("the logger never reaches the OpenTelemetry Node SDK", () => {
  test("lib/logger.ts does not import instrumentation.node", () => {
    expect(loggerSource).not.toContain("instrumentation.node");
    for (const specifier of staticImportSpecifiers(loggerSource)) {
      expect(specifier).not.toMatch(/instrumentation\.node/u);
    }
  });

  test("lib/logger.ts takes the provider from the dedicated module", () => {
    expect(staticImportSpecifiers(loggerSource)).toContain(
      "./otel-logger-provider",
    );
  });

  test("the provider module pulls in no Node-only tracing dependency", () => {
    // Specifiers, not raw text: the module's own comment names these packages
    // to explain why they are absent, and that prose must not fail the test.
    const specifiers = [
      ...staticImportSpecifiers(providerSource),
      ...[...providerSource.matchAll(/import\(\s*"([^"]+)"\s*\)/gu)].map(
        (match) => match[1],
      ),
    ];
    for (const forbidden of [
      "@opentelemetry/sdk-node",
      "@opentelemetry/context-async-hooks",
      "@posthog/ai",
      "@grpc/grpc-js",
    ]) {
      expect(specifiers).not.toContain(forbidden);
    }
  });

  test("instrumentation.node.ts reaches the Node SDK only dynamically", () => {
    // A static specifier would put the SDK back on every importer's graph, which
    // is exactly the shape that broke the build.
    expect(staticImportSpecifiers(instrumentationNodeSource)).not.toContain(
      "@opentelemetry/sdk-node",
    );
    expect(instrumentationNodeSource).toContain(
      'import("@opentelemetry/sdk-node")',
    );
  });

  test("instrumentation.node.ts imports the provider relatively, not via the alias", () => {
    // The independent CSF plugin application compiles this file in its own
    // project, where "@/" resolves to that app's root and the alias fails to
    // resolve. `bun run plugin:apps:check` catches it; this states why.
    expect(staticImportSpecifiers(instrumentationNodeSource)).toContain(
      "./lib/otel-logger-provider",
    );
    expect(instrumentationNodeSource).not.toContain(
      '"@/lib/otel-logger-provider"',
    );
  });
});
