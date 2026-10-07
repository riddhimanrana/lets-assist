import { SeverityNumber } from "@opentelemetry/api-logs";
import { loggerProvider } from "./otel-logger-provider";
import { safeErrorAttributes, sanitizeLogRecord } from "./log-privacy";

const logger = loggerProvider.getLogger("lets-assist");

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogAttributes {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Helper function to log messages with OpenTelemetry
 * @param level - Log level (debug, info, warn, error)
 * @param message - Log message
 * @param attributes - Additional structured attributes
 */
export function log(
  level: LogLevel,
  message: string,
  attributes?: LogAttributes,
) {
  const severityMap = {
    debug: SeverityNumber.DEBUG,
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
  };

  logger.emit({
    ...sanitizeLogRecord(message, attributes),
    severityNumber: severityMap[level],
    severityText: level.toUpperCase(),
  });
}

/**
 * Log an error category and reviewed diagnostics without its message or stack
 */
export function logError(
  message: string,
  error: unknown,
  attributes?: LogAttributes,
) {
  logger.emit({
    ...sanitizeLogRecord(message, {
      ...attributes,
      ...safeErrorAttributes(error),
    }),
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
  });
}

/**
 * Log an info message
 */
export function logInfo(message: string, attributes?: LogAttributes) {
  log("info", message, attributes);
}

/**
 * Log a warning message
 */
export function logWarn(message: string, attributes?: LogAttributes) {
  log("warn", message, attributes);
}

/**
 * Log a debug message
 */
export function logDebug(message: string, attributes?: LogAttributes) {
  log("debug", message, attributes);
}

/**
 * Flush logs immediately (use in route handlers with after() from next/server)
 */
export async function flushLogs() {
  await loggerProvider.forceFlush();
}
