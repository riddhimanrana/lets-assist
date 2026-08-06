import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";

// Keep every Node-only OpenTelemetry dependency behind instrumentation.ts's
// NEXT_RUNTIME guard. This is required for the Webpack dev fallback and also
// prevents Edge bundles from trying to resolve Node core modules.
const processors: BatchLogRecordProcessor[] = [];
let posthogTraceSdkStarted = false;

if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
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
} else {
  console.warn(
    "[Instrumentation] NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN not set — skipping PostHog log exporter",
  );
}

export const loggerProvider = new LoggerProvider({
  resource: resourceFromAttributes({ "service.name": "lets-assist" }),
  processors,
});

async function startPostHogTraceExporter() {
  if (
    posthogTraceSdkStarted ||
    !process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  ) {
    return;
  }

  try {
    const [{ NodeSDK }, { PostHogTraceExporter }] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@posthog/ai/otel"),
    ]);

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({ "service.name": "lets-assist" }),
      traceExporter: new PostHogTraceExporter({
        projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
        host: "https://us.i.posthog.com",
      }),
    });

    await sdk.start();
    posthogTraceSdkStarted = true;
  } catch (error) {
    console.warn(
      "[Instrumentation] Failed to start PostHog trace exporter",
      error,
    );
  }
}

export async function registerNodeInstrumentation() {
  logs.setGlobalLoggerProvider(loggerProvider);
  await startPostHogTraceExporter();
}
