import { SAFE_LOG_MESSAGES } from "./log-event-catalog";
import signupSteps from "./signup-diagnostic-steps.json";

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
  "slot_capacity",
  "active_count",
  "plugin_count",
  "occurrenceCount",
  "elapsedMs",
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
  "has_waiver_evidence",
  "is_anonymous",
  "firstCapture",
  "conflict",
  "csf",
  "duplicate",
  "reductionApplied",
]);
const ENUMS: Record<string, ReadonlySet<string>> = {
  failureCode: new Set([
    "worker_context_unavailable",
    "workbook_metadata_unavailable",
    "semester_tabs_unavailable",
    "prepublication_failure",
    "publication_outcome_unknown",
    "unclassified_failure",
    "workbook_exception",
  ]),
  disposition: new Set(["retryable", "unknown"]),
  worker: new Set([
    "project-cancellations",
    "csf-communications-dispatch",
    "data-exports",
  ]),
  receipt_phase: new Set(["start", "finish"]),
  signup_step: new Set(signupSteps),
  eventType: new Set([
    "email.sent",
    "email.delivered",
    "email.delivery_delayed",
    "email.bounced",
    "email.complained",
    "email.opened",
    "email.clicked",
    "email.failed",
    "email.suppressed",
    "unsupported",
    "unknown",
  ]),
  reasonCode: new Set([
    "unroutable_tenant",
    "malformed_event_shape",
    "unsupported_event_shape",
    "immutable_replay_conflict",
    "contradictory_routing_evidence",
    "cross_tenant_evidence",
    "unknown_tenant_coordinate",
    "unclassified_ledger_failure",
  ]),
  quarantineFailureCode: new Set([
    "unroutable_tenant",
    "malformed_event_shape",
    "unsupported_event_shape",
    "immutable_replay_conflict",
    "contradictory_routing_evidence",
    "cross_tenant_evidence",
    "unknown_tenant_coordinate",
    "unclassified_ledger_failure",
  ]),
  faultKind: new Set([
    "type_error",
    "range_error",
    "syntax_error",
    "error",
    "non_error",
  ]),
  classification: new Set(["permanent", "retryable"]),
  processingState: new Set([
    "pending",
    "applied",
    "ignored",
    "quarantined",
    "unknown",
  ]),
  alertCode: new Set(["resend_webhook_signature_failure"]),
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
      (key === "error_code" || key === "sqlstate") &&
      typeof value === "string" &&
      /^(?:[0-9]{5}|55P03|40P01|PT409|PGRST[0-9]{3}|ECONNRESET|ETIMEDOUT|ECONNREFUSED)$/.test(
        value,
      )
    )
      attributes[key] = value;
    else if (
      key === "providerEventDigest" &&
      typeof value === "string" &&
      /^[a-f0-9]{16}$/.test(value)
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
    const descriptors = Object.getOwnPropertyDescriptors(error);
    const ownValue = (key: string) => {
      const descriptor = descriptors[key];
      return descriptor && "value" in descriptor ? descriptor.value : undefined;
    };
    const name = ownValue("name");
    return {
      error_kind:
        typeof name === "string" && ENUMS.error_kind.has(name)
          ? name
          : error instanceof TypeError
            ? "TypeError"
            : "Error",
      error_code: ownValue("code"),
      error_digest: ownValue("digest"),
    };
  } catch {
    return { error_kind: "Error" };
  }
}
