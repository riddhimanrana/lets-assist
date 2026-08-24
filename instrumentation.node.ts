import { logs } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";

// Relative, not the "@/" alias. The independent CSF plugin application compiles
// this file in its own project context, where "@/" resolves to that app's root
// and the alias would not find this module.
import { loggerProvider } from "./lib/otel-logger-provider";

// Keep every Node-only OpenTelemetry dependency behind instrumentation.ts's
// NEXT_RUNTIME guard. This is required for the Webpack dev fallback and also
// prevents Edge bundles from trying to resolve Node core modules.
//
// `@opentelemetry/sdk-node` in particular must stay behind the dynamic import
// below. It reaches `@grpc/grpc-js`, which requires Node builtins that cannot
// be resolved from inside a bundle; the log provider it used to sit beside now
// lives in `lib/otel-logger-provider` so that logging never drags it in.
let posthogTraceSdkStarted = false;

export { loggerProvider };

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
