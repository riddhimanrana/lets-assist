export type GoogleCalendarAccessState =
  | { status: "accessible" }
  | { status: "missing" }
  | { status: "forbidden"; httpStatus: 401 | 403 }
  | {
      status: "retryable_error";
      reason:
        | "rate_limited"
        | "server_error"
        | "timeout"
        | "network_error"
        | "unknown_error"
        | "malformed_response"
        | "unexpected_status";
      httpStatus?: number;
    };

type CalendarLookupResponse = {
  ok: boolean;
  status: number;
};

function isCalendarLookupResponse(
  response: unknown,
): response is CalendarLookupResponse {
  if (!response || typeof response !== "object") {
    return false;
  }

  const candidate = response as Partial<CalendarLookupResponse>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.status === "number" &&
    Number.isInteger(candidate.status) &&
    candidate.status >= 100 &&
    candidate.status <= 599
  );
}

export function classifyGoogleCalendarLookupResponse(
  response: unknown,
): GoogleCalendarAccessState {
  if (!isCalendarLookupResponse(response)) {
    return {
      status: "retryable_error",
      reason: "malformed_response",
    };
  }

  if (response.ok && response.status >= 200 && response.status < 300) {
    return { status: "accessible" };
  }

  if (response.status === 404) {
    return { status: "missing" };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: "forbidden",
      httpStatus: response.status,
    };
  }

  if (response.status === 408 || response.status === 429) {
    return {
      status: "retryable_error",
      reason: response.status === 429 ? "rate_limited" : "timeout",
      httpStatus: response.status,
    };
  }

  if (response.status >= 500) {
    return {
      status: "retryable_error",
      reason: "server_error",
      httpStatus: response.status,
    };
  }

  return {
    status: "retryable_error",
    reason: "unexpected_status",
    httpStatus: response.status,
  };
}

export function classifyGoogleCalendarLookupError(
  error: unknown,
): GoogleCalendarAccessState {
  const errorName =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";

  if (errorName === "AbortError" || errorName === "TimeoutError") {
    return {
      status: "retryable_error",
      reason: "timeout",
    };
  }

  if (error instanceof Error) {
    return {
      status: "retryable_error",
      reason: "network_error",
    };
  }

  return {
    status: "retryable_error",
    reason: "unknown_error",
  };
}
