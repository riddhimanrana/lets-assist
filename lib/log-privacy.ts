import { SAFE_LOG_MESSAGES } from "./log-event-catalog";

type LogValue = string | number | boolean;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID_KEYS = new Set([
  "trace_id",
  "request_id",
  "job_id",
  "delivery_id",
  "receipt_id",
  "correlationId",
]);
const NUMBER_KEYS = new Set([
  "certificate_count",
  "email_accepted_count",
  "email_error_count",
  "record_count",
  "rows_count",
  "rpc_attempt_count",
  "settlement_attempts",
  "zip_size_bytes",
  "recipient_count",
  "text_length",
  "status",
  "http_status",
]);
const BOOLEAN_KEYS = new Set([
  "has_content_id",
  "has_modified_time",
  "has_trashed",
  "has_version",
  "identity_matches",
  "is_native_sheet",
  "replayed",
  "has_user_id",
]);
const ENUMS: Record<string, ReadonlySet<string>> = {
  outcome: new Set([
    "accepted",
    "definitive_failure",
    "retryable_pre_send",
    "unknown_outcome",
    "skipped",
    "replayed",
    "partial",
    "refused",
    "completed",
    "failed",
    "pending",
  ]),
  phase: new Set([
    "local_validation",
    "preference_check",
    "transport_setup",
    "provider_request",
    "provider_response",
  ]),
  transport: new Set(["resend", "mailpit"]),
  error_kind: new Set([
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "URIError",
    "AbortError",
    "TimeoutError",
    "AggregateError",
  ]),
  route_type: new Set(["render", "route", "action", "proxy"]),
  router_kind: new Set(["App Router", "Pages Router"]),
  request_method: new Set([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ]),
  severity: new Set(["info", "warning", "error", "critical"]),
};

/** Project only reviewed diagnostic fields. No URLs, provider bodies, people, or stacks. */
export function sanitizeLogRecord(
  message: string,
  input: Record<string, unknown> = {},
) {
  const attributes: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (ID_KEYS.has(key) && typeof value === "string" && UUID.test(value))
      attributes[key] = value;
    else if (
      NUMBER_KEYS.has(key) &&
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 1_000_000_000
    )
      attributes[key] = value;
    else if (BOOLEAN_KEYS.has(key) && typeof value === "boolean")
      attributes[key] = value;
    else if (
      typeof value === "string" &&
      Object.hasOwn(ENUMS, key) &&
      ENUMS[key].has(value)
    )
      attributes[key] = value;
    else if (
      key === "error_code" &&
      typeof value === "string" &&
      /^(?:[0-9]{5}|PGRST[0-9]{3}|ECONNRESET|ETIMEDOUT|ECONNREFUSED)$/.test(
        value,
      )
    )
      attributes[key] = value;
    else if (
      key === "error_digest" &&
      typeof value === "string" &&
      /^[0-9]{1,10}$/.test(value)
    )
      attributes[key] = value;
  }
  const registered = SAFE_LOG_MESSAGES.has(message);
  if (!registered) attributes.unregistered_event = true;
  return {
    body: registered ? message : "Unregistered application event",
    attributes,
  };
}

export function safeErrorAttributes(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") return { error_kind: "Error" };
  try {
    const candidate = error as {
      name?: unknown;
      code?: unknown;
      digest?: unknown;
    };
    return {
      error_kind:
        typeof candidate.name === "string" &&
        ENUMS.error_kind.has(candidate.name)
          ? candidate.name
          : "Error",
      error_code: candidate.code,
      error_digest: candidate.digest,
    };
  } catch {
    return { error_kind: "Error" };
  }
}
