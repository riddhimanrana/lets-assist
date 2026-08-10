import type { GoogleOAuthConnectionBindingExpectation } from "./google-oauth-connection-binding";

/** The one Google identity authorized to read DVHS CSF source files. */
export const DVHS_CSF_GOOGLE_IMPORT_EMAIL = "dvhighcsf@gmail.com";

export type GoogleOAuthCallbackIdentityDecision =
  | { ok: true }
  | {
      ok: false;
      error: "unverified_google_account" | "wrong_google_account";
    };

function normalizeGoogleIdentityEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function isDvhsCsfGoogleImportBinding(
  binding: GoogleOAuthConnectionBindingExpectation,
) {
  return (
    binding.purpose === "csf_import" &&
    binding.pluginKey === "dvhs-csf" &&
    Boolean(binding.organizationId)
  );
}

/**
 * Stored credentials are usable only when their provider identity still names
 * the chapter account. This also fences credentials created before callback
 * enforcement existed.
 */
export function googleOAuthConnectionIdentityMatches(
  binding: GoogleOAuthConnectionBindingExpectation,
  email: string | null | undefined,
) {
  if (!isDvhsCsfGoogleImportBinding(binding)) return true;
  return normalizeGoogleIdentityEmail(email) === DVHS_CSF_GOOGLE_IMPORT_EMAIL;
}

export function googleOAuthConnectionHasVerifiedCsfIdentity(
  binding: GoogleOAuthConnectionBindingExpectation,
  evidence: {
    connectionEmail: string | null | undefined;
    identityEmail: string | null | undefined;
    identityVerifiedAt: string | null | undefined;
  },
) {
  if (!isDvhsCsfGoogleImportBinding(binding)) return true;
  const identityEmail = normalizeGoogleIdentityEmail(evidence.identityEmail);
  const connectionEmail = normalizeGoogleIdentityEmail(
    evidence.connectionEmail,
  );
  return (
    Boolean(evidence.identityVerifiedAt) &&
    identityEmail === DVHS_CSF_GOOGLE_IMPORT_EMAIL &&
    connectionEmail === identityEmail
  );
}

/** Require both Google's verification bit and the exact chapter identity. */
export function validateGoogleOAuthCallbackIdentity(input: {
  binding: GoogleOAuthConnectionBindingExpectation;
  email: string | null | undefined;
  emailVerified: boolean;
}): GoogleOAuthCallbackIdentityDecision {
  if (!isDvhsCsfGoogleImportBinding(input.binding)) return { ok: true };
  if (!input.emailVerified) {
    return { ok: false, error: "unverified_google_account" };
  }
  if (!googleOAuthConnectionIdentityMatches(input.binding, input.email)) {
    return { ok: false, error: "wrong_google_account" };
  }
  return { ok: true };
}
