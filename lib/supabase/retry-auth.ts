interface AuthRetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const RETRYABLE_ERROR_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === "string") {
    return maybeCode;
  }

  const causeCode = (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof causeCode === "string" ? causeCode : undefined;
}

function extractErrorMessage(error: unknown): string {
  if (!error) {
    return "";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    const causeMessage =
      error.cause && typeof error.cause === "object"
        ? (error.cause as { message?: unknown }).message
        : undefined;

    return [error.message, typeof causeMessage === "string" ? causeMessage : ""]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message.toLowerCase() : "";
}

export function isRetryableAuthError(error: unknown): boolean {
  const code = extractErrorCode(error);
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  if (error && typeof error === "object") {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name === "AuthRetryableFetchError") {
      return true;
    }

    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status === 0) {
      return true;
    }
  }

  const message = extractErrorMessage(error);
  return (
    message.includes("fetch failed") ||
    message.includes("connect timeout") ||
    message.includes("network") ||
    message.includes("timed out")
  );
}

export async function withRetryableAuthOperation<T>(
  operation: () => Promise<T>,
  options: AuthRetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 300,
    maxDelayMs = 2000,
  } = options;

  let currentAttempt = 0;
  let lastError: unknown;

  while (currentAttempt < maxAttempts) {
    currentAttempt += 1;

    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const shouldRetry = isRetryableAuthError(error) && currentAttempt < maxAttempts;
      if (!shouldRetry) {
        throw error;
      }

      const backoff = Math.min(maxDelayMs, initialDelayMs * 2 ** (currentAttempt - 1));
      await sleep(backoff);
    }
  }

  throw lastError;
}