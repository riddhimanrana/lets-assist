import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";

// The log provider lives here rather than in `instrumentation.node.ts` because
// `lib/logger.ts` needs it on every server request, and `instrumentation.node`
// also reaches `@opentelemetry/sdk-node` for tracing. Importing the two from
// one module made every route that logs pull the Node SDK, and through it
// `@grpc/grpc-js`, into its bundle. Turbopack then tried to resolve the Node
// builtins grpc requires (`async_hooks`, `dns`, `fs`) inside a bundled module
// and failed with 25 module-not-found errors, breaking every production build.
//
// Splitting them keeps the heavy tracing dependency behind the
// `NEXT_RUNTIME === "nodejs"` guard in `instrumentation.ts`, where it belongs,
// and leaves this module holding only the HTTP log exporter.
//
// This module is deliberately NOT marked `server-only`, though it should be.
// `services/google-sheets.ts` is a barrel that re-exports `google-sheets-csf`,
// which imports `lib/logger`, so a client component pulling one pure helper
// (`formatCsfSheetBounds`, via `import-sheet-analysis`) drags this whole chain
// into the browser bundle. That leak predates this split and is bundle bloat
// rather than a build failure now that the Node SDK is out of the path. Adding
// the guard here makes the build fail until that barrel is untangled, so it is
// left off and tracked separately.
import { telemetryRuntime } from "./telemetry-runtime";

const runtime = telemetryRuntime();
const processors: BatchLogRecordProcessor[] = [];

if (
  typeof window === "undefined" &&
  runtime.enabled &&
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
) {
  processors.push(
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: "https://us.i.posthog.com/i/v1/logs",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN}`,
          "Content-Type": "application/json",
        },
      }),
    }),
  );
}

export const loggerProvider = new LoggerProvider({
  resource: resourceFromAttributes(runtime.attributes),
  processors,
});
