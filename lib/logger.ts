import { SeverityNumber } from '@opentelemetry/api-logs'
import { loggerProvider } from '@/instrumentation'

const logger = loggerProvider.getLogger('lets-assist')

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogAttributes {
  [key: string]: string | number | boolean | undefined
}

/**
 * Helper function to log messages with OpenTelemetry
 * @param level - Log level (debug, info, warn, error)
 * @param message - Log message
 * @param attributes - Additional structured attributes
 */
export function log(level: LogLevel, message: string, attributes?: LogAttributes) {
  const severityMap = {
    debug: SeverityNumber.DEBUG,
    info: SeverityNumber.INFO,
    warn: SeverityNumber.WARN,
    error: SeverityNumber.ERROR,
  }

  logger.emit({
    body: message,
    severityNumber: severityMap[level],
    severityText: level.toUpperCase(),
    attributes: attributes || {},
  })
}

/**
 * Log an error with stack trace and additional context
 */
export function logError(message: string, error: unknown, attributes?: LogAttributes) {
  const errorAttributes: LogAttributes = {
    ...attributes,
    error_message: error instanceof Error ? error.message : String(error),
    error_stack: error instanceof Error ? error.stack : undefined,
  }

  logger.emit({
    body: message,
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
    attributes: errorAttributes,
  })
}

/**
 * Log an info message
 */
export function logInfo(message: string, attributes?: LogAttributes) {
  log('info', message, attributes)
}

/**
 * Log a warning message
 */
export function logWarn(message: string, attributes?: LogAttributes) {
  log('warn', message, attributes)
}

/**
 * Log a debug message
 */
export function logDebug(message: string, attributes?: LogAttributes) {
  log('debug', message, attributes)
}

/**
 * Flush logs immediately (use in route handlers with after() from next/server)
 */
export async function flushLogs() {
  await loggerProvider.forceFlush()
}
