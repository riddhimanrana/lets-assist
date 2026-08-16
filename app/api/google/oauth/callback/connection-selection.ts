export type ExistingGoogleConnection = {
  id: string;
  refresh_token: string | null;
  calendar_email: string | null;
  connection_type: string | null;
  preferences?: unknown;
  updated_at?: string | null;
  connected_at?: string | null;
};

function normalizeGoogleIdentityEmail(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

/**
 * A refresh token is bound to the Google identity that issued it. Google does
 * not return a new refresh token on every authorization response, so reconnects
 * may reuse the stored encrypted token only when the newly authorized identity
 * is the same one recorded on the existing connection.
 */
export function canReuseExistingGoogleRefreshToken(
  connection: Pick<
    ExistingGoogleConnection,
    "calendar_email" | "refresh_token"
  > | null,
  authorizedEmail: string | null | undefined,
): boolean {
  if (!connection?.refresh_token) return false;

  const existingEmail = normalizeGoogleIdentityEmail(connection.calendar_email);
  const currentEmail = normalizeGoogleIdentityEmail(authorizedEmail);
  return Boolean(
    existingEmail && currentEmail && existingEmail === currentEmail,
  );
}
