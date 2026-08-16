/**
 * Shared vocabulary for Google OAuth connection intents.
 *
 * The authorization-request lifecycle itself -- state, PKCE, the attempt-
 * specific cookie, and the durable ledger -- lives in `google-oauth-attempt`
 * and `google-oauth-attempt-store`. This module stays free of crypto and I/O
 * so purposes and capabilities can be imported from anywhere, including the
 * private plugin, without pulling in server-only dependencies.
 */

export const GOOGLE_OAUTH_CONNECTION_PURPOSES = [
  "personal_calendar",
  "personal_sheets",
  "organization_calendar",
  "organization_sheets",
  "csf_import",
] as const;

export type GoogleOAuthConnectionPurpose =
  (typeof GOOGLE_OAUTH_CONNECTION_PURPOSES)[number];

export const GOOGLE_OAUTH_CSF_IMPORT_CAPABILITIES = [
  "import_applications",
  "import_members",
  "import_meetings",
  "import_partner_clubs",
] as const;

export type GoogleOAuthCsfImportCapability =
  (typeof GOOGLE_OAUTH_CSF_IMPORT_CAPABILITIES)[number];

const SAFE_REDIRECT_ORIGIN = "https://lets-assist.invalid";

export type GoogleOAuthConnectionIntent = {
  organizationId: string | null;
  pluginKey: "dvhs-csf" | null;
  purpose: GoogleOAuthConnectionPurpose;
  requestedCapability: GoogleOAuthCsfImportCapability | null;
};

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function isGoogleOAuthConnectionPurpose(
  value: string | null | undefined,
): value is GoogleOAuthConnectionPurpose {
  return GOOGLE_OAUTH_CONNECTION_PURPOSES.some((purpose) => purpose === value);
}

export function isGoogleOAuthCsfImportCapability(
  value: string | null | undefined,
): value is GoogleOAuthCsfImportCapability {
  return GOOGLE_OAUTH_CSF_IMPORT_CAPABILITIES.some(
    (capability) => capability === value,
  );
}

/**
 * The canonical statement of which intent combinations exist. Every surface
 * that mints or replays an attempt validates against this, so a purpose can
 * never silently satisfy a binding it was not issued for.
 */
export function isValidGoogleOAuthIntent(
  value: GoogleOAuthConnectionIntent,
): boolean {
  if (value.purpose === "csf_import") {
    return Boolean(
      value.organizationId &&
      value.pluginKey === "dvhs-csf" &&
      isGoogleOAuthCsfImportCapability(value.requestedCapability),
    );
  }

  if (value.pluginKey !== null || value.requestedCapability !== null) {
    return false;
  }

  if (
    value.purpose === "organization_calendar" ||
    value.purpose === "organization_sheets"
  ) {
    return Boolean(value.organizationId);
  }

  return value.organizationId === null;
}

export function normalizeGoogleOAuthReturnTo(
  returnTo: string | null | undefined,
): string | null {
  if (
    !returnTo ||
    returnTo.trim() !== returnTo ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\") ||
    hasControlCharacter(returnTo)
  ) {
    return null;
  }

  try {
    const parsed = new URL(returnTo, SAFE_REDIRECT_ORIGIN);
    if (parsed.origin !== SAFE_REDIRECT_ORIGIN) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
