import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { logs } from '@opentelemetry/api-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'

// Create LoggerProvider outside register() so it can be exported and flushed in route handlers
const processors: BatchLogRecordProcessor[] = [];

// Only configure the PostHog OTLP exporter if a key is present
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  processors.push(
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: 'https://us.i.posthog.com/i/v1/logs',
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_POSTHOG_KEY}`,
          'Content-Type': 'application/json',
        },
      })
    )
  );
} else {
  // Avoid leaking undefined Authorization headers when no key is configured
  // and make it obvious in logs that instrumentation is disabled.
  // Note: this is useful for local dev where you don't want to send logs.
  console.warn('[Instrumentation] NEXT_PUBLIC_POSTHOG_KEY not set — skipping PostHog log exporter');
}

export const loggerProvider = new LoggerProvider({
  resource: resourceFromAttributes({ 'service.name': 'lets-assist' }),
  processors,
})

export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    logs.setGlobalLoggerProvider(loggerProvider)
  }
}
