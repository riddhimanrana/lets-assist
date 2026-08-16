/**
 * One catalogue of operator-facing outcomes for every Google connection
 * surface: personal Calendar, organization Calendar, organization Sheets,
 * Reports, and the DVHS-CSF imports panel.
 *
 * The callback only ever emits a bounded outcome code plus an optional
 * correlation code. Nothing here interpolates a provider message, a state
 * value, an attempt id, or an account address, so a surface can render an
 * outcome without deciding what is safe to show.
 */

export type GoogleOAuthNoticeTone = "success" | "warning" | "error";

export type GoogleOAuthNotice = {
  tone: GoogleOAuthNoticeTone;
  message: string;
  /** True when the operator's next step is to start the connection again. */
  canRetry: boolean;
};

const GOOGLE_OAUTH_OUTCOME_MESSAGES: Readonly<
  Record<string, Omit<GoogleOAuthNotice, "canRetry"> & { canRetry?: boolean }>
> = {
  // --- consent and grant shape -------------------------------------------
  access_denied: {
    tone: "warning",
    message: "Google access was not changed. Nothing was connected.",
    canRetry: true,
  },
  missing_required_scope: {
    tone: "error",
    message:
      "Google did not grant the permission this connection needs. Start again and leave the requested permission checked.",
    canRetry: true,
  },
  no_refresh_token: {
    tone: "error",
    message:
      "Google did not return durable access. Start again, choose the account, and approve the consent screen rather than dismissing it.",
    canRetry: true,
  },

  // --- attempt lifecycle --------------------------------------------------
  expired_state: {
    tone: "warning",
    message:
      "This connection attempt timed out before Google returned. Start it again from this page.",
    canRetry: true,
  },
  invalid_state: {
    tone: "error",
    message:
      "This connection attempt could not be verified, so nothing was changed. Start again from this page.",
    canRetry: true,
  },
  connection_in_progress: {
    tone: "warning",
    message:
      "Another tab is still finishing this connection. Wait a moment, then recheck the status before starting again.",
    canRetry: false,
  },
  attempt_not_started: {
    tone: "error",
    message:
      "The connection could not be started, so you were not sent to Google. Try again in a moment.",
    canRetry: true,
  },
  invalid_request: {
    tone: "error",
    message: "Google did not return a usable authorization. Start again.",
    canRetry: true,
  },

  // --- identity -----------------------------------------------------------
  wrong_google_account: {
    tone: "error",
    message:
      "That is not the approved account for this connection. Start again and pick the approved account.",
    canRetry: true,
  },
  unverified_google_account: {
    tone: "error",
    message:
      "Google did not provide a verified account identity, so nothing was connected.",
    canRetry: true,
  },
  failed_to_get_email: {
    tone: "error",
    message:
      "Google did not return an account identity, so nothing was connected.",
    canRetry: true,
  },

  // --- authorization ------------------------------------------------------
  unauthorized: {
    tone: "error",
    message: "Sign in again before connecting a Google account.",
    canRetry: false,
  },
  org_admin_required: {
    tone: "error",
    message:
      "Your current role cannot manage this Google connection. Ask an organization admin.",
    canRetry: false,
  },
  google_capability_required: {
    tone: "error",
    message:
      "Your current role no longer permits this connection. Ask an officer who holds the matching permission.",
    canRetry: false,
  },

  // --- provider and persistence ------------------------------------------
  token_exchange_failed: {
    tone: "error",
    message: "Google could not finish the connection. Try again.",
    canRetry: true,
  },
  connection_failed: {
    tone: "error",
    message: "The verified Google connection could not be saved. Try again.",
    canRetry: true,
  },
  org_calendar_failed: {
    tone: "error",
    message:
      "The organization calendar could not be prepared. The account was not connected.",
    canRetry: true,
  },
  attempt_unreadable: {
    tone: "error",
    message:
      "This connection attempt could not be completed and was closed safely. Start again.",
    canRetry: true,
  },
  unknown: {
    tone: "error",
    message: "The connection did not finish. Nothing was changed.",
    canRetry: true,
  },
};

const CONNECTED_NOTICE: GoogleOAuthNotice = {
  tone: "success",
  message: "The Google account is connected.",
  canRetry: false,
};

/**
 * Read a callback result from a query string.
 *
 * An unrecognized code is deliberately rendered as the generic outcome rather
 * than echoed, so a code this build does not know about can never become
 * screen text.
 */
export function readGoogleOAuthCallbackNotice(
  search: string | URLSearchParams,
  options: { connectedMessage?: string } = {},
): (GoogleOAuthNotice & { correlationId: string | null }) | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const correlationId = params.get("code");
  const safeCorrelationId = /^[A-Z0-9]{10}$/u.test(correlationId ?? "")
    ? correlationId
    : null;

  if (params.get("success") === "connected") {
    return {
      ...CONNECTED_NOTICE,
      ...(options.connectedMessage
        ? { message: options.connectedMessage }
        : {}),
      correlationId: null,
    };
  }

  const error = params.get("error");
  if (!error) return null;

  const entry =
    GOOGLE_OAUTH_OUTCOME_MESSAGES[error] ??
    GOOGLE_OAUTH_OUTCOME_MESSAGES.unknown;

  return {
    tone: entry.tone,
    message: entry.message,
    canRetry: entry.canRetry ?? true,
    correlationId: safeCorrelationId,
  };
}

/** The parameters a surface should strip after rendering an outcome. */
export const GOOGLE_OAUTH_CALLBACK_PARAMS = [
  "success",
  "error",
  "email",
  "code",
] as const;
