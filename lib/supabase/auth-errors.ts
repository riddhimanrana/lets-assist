type SupabaseAuthErrorLike = {
  message?: string | null;
  code?: string | null;
  status?: number | null;
};

/**
 * Returns true when Supabase indicates the JWT subject/user no longer exists.
 * This commonly happens when stale cookies reference a deleted/banned user.
 */
export function isStaleSupabaseAuthUserError(
  error: SupabaseAuthErrorLike | null | undefined,
): boolean {
  if (!error) {
    return false;
  }

  const message = `${error.message ?? ""}`.toLowerCase();
  const code = `${error.code ?? ""}`.toLowerCase();
  const status = typeof error.status === "number" ? error.status : null;

  if (code === "user_not_found") {
    return true;
  }

  if (
    status === 404 &&
    message.includes("user") &&
    message.includes("not found")
  ) {
    return true;
  }

  if (message.includes("user from sub claim in jwt does not exist")) {
    return true;
  }

  return false;
}

/** A temporary Auth outage is neither a revoked session nor a sign-out. */
export function isRetryableSupabaseAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; status?: number };
  return (
    candidate.name === "AuthRetryableFetchError" ||
    candidate.status === 429 ||
    (typeof candidate.status === "number" &&
      candidate.status >= 500 &&
      candidate.status <= 599)
  );
}
