export type HoursPublicationRpcError = {
  code?: string;
};

export type HoursPublicationRpcAttempt = {
  data: unknown;
  error: HoursPublicationRpcError | null;
};

export type HoursPublicationRpcResult<T> = {
  publication: T | null;
  attempts: number;
  errorCode: string | null;
  invalidResponse: boolean;
};

function thrownErrorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

/**
 * Repeat the exact idempotent database request once when its response is lost
 * or malformed. The database receipt owns publication uniqueness, and email
 * work starts only after this helper returns a validated durable receipt.
 */
export async function executeReplaySafeHoursPublicationRpc<T>(
  attempt: () => Promise<HoursPublicationRpcAttempt>,
  isPublication: (value: unknown) => value is T,
): Promise<HoursPublicationRpcResult<T>> {
  let errorCode: string | null = null;
  let invalidResponse = false;

  for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber++) {
    try {
      const result = await attempt();
      if (!result.error && isPublication(result.data)) {
        return {
          publication: result.data,
          attempts: attemptNumber,
          errorCode: null,
          invalidResponse: false,
        };
      }

      errorCode = result.error?.code ?? null;
      invalidResponse = !result.error;
    } catch (error) {
      errorCode = thrownErrorCode(error);
      invalidResponse = false;
    }
  }

  return {
    publication: null,
    attempts: 2,
    errorCode,
    invalidResponse,
  };
}
