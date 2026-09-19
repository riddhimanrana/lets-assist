type AuthFlowErrorLike = {
  code?: unknown;
  message?: unknown;
};

const RESTARTABLE_AUTH_FLOW_CODES = new Set([
  "bad_code_verifier",
  "flow_state_expired",
  "pkce_code_verifier_not_found",
]);

/**
 * These failures cannot be retried with the current callback credential. The
 * safe recovery is to start a new auth flow while preserving the local return
 * path. Provider text is deliberately excluded from the browser response.
 */
export function isRestartableAuthFlowError(
  error: AuthFlowErrorLike | null | undefined,
): boolean {
  const code = typeof error?.code === "string" ? error.code : "";
  if (RESTARTABLE_AUTH_FLOW_CODES.has(code)) return true;

  const message =
    typeof error?.message === "string" ? error.message.toLowerCase() : "";

  return (
    message.includes("pkce code verifier not found") ||
    message.includes("code challenge does not match") ||
    message.includes("flow state has expired") ||
    message.includes("state has already been used")
  );
}
