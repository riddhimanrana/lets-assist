import { normalizeRedirectPath } from "@/app/signup/redirect-utils";

export type AuthenticatorAssuranceLevel = "aal1" | "aal2" | null;

export type MfaAssuranceLike = {
  currentLevel?: string | null;
  nextLevel?: string | null;
};

export type MfaFactorLike = {
  id: string;
  factor_type?: string | null;
  friendly_name?: string | null;
  status?: string | null;
  created_at?: string | null;
  last_challenged_at?: string | null;
};

export type MfaListFactorsLike = {
  all?: MfaFactorLike[] | null;
  totp?: MfaFactorLike[] | null;
  phone?: MfaFactorLike[] | null;
  webauthn?: MfaFactorLike[] | null;
};

export function normalizeAuthenticatorAssuranceLevel(
  level: string | null | undefined,
): AuthenticatorAssuranceLevel {
  if (level === "aal1" || level === "aal2") {
    return level;
  }

  return null;
}

function isFactor(value: unknown): value is MfaFactorLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return typeof (value as { id?: unknown }).id === "string";
}

export function getVerifiedTotpFactors(
  factors: MfaListFactorsLike | null | undefined,
): MfaFactorLike[] {
  const totpFactors = Array.isArray(factors?.totp)
    ? factors.totp
    : Array.isArray(factors?.all)
      ? factors.all.filter((factor) => factor.factor_type === "totp")
      : [];

  return totpFactors
    .filter(isFactor)
    .filter((factor) => factor.status !== "unverified")
    .sort((left, right) => {
      const leftCreatedAt = left.created_at ?? "";
      const rightCreatedAt = right.created_at ?? "";

      return leftCreatedAt.localeCompare(rightCreatedAt);
    });
}

export function getMfaFactorLabel(
  factor: Pick<MfaFactorLike, "friendly_name">,
  index = 0,
): string {
  const friendlyName = factor.friendly_name?.trim();

  if (friendlyName) {
    return friendlyName;
  }

  const suffix = index > 0 ? ` ${index + 1}` : "";
  return `Authenticator App${suffix}`;
}

export function deriveAuthenticatorAssurance(
  currentLevel: string | null | undefined,
  factors: MfaListFactorsLike | null | undefined,
): {
  currentLevel: AuthenticatorAssuranceLevel;
  nextLevel: AuthenticatorAssuranceLevel;
} {
  const normalizedCurrentLevel = normalizeAuthenticatorAssuranceLevel(currentLevel);
  const hasVerifiedTotpFactor = getVerifiedTotpFactors(factors).length > 0;

  return {
    currentLevel: normalizedCurrentLevel,
    nextLevel: hasVerifiedTotpFactor ? "aal2" : normalizedCurrentLevel,
  };
}

export function isMfaChallengeRequired(
  assurance: MfaAssuranceLike | null | undefined,
): boolean {
  return assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2";
}

export function shouldPromptForMfaChallenge(
  assurance: MfaAssuranceLike | null | undefined,
  factors: MfaListFactorsLike | null | undefined,
): boolean {
  if (isMfaChallengeRequired(assurance)) {
    return true;
  }

  const verifiedTotpFactors = getVerifiedTotpFactors(factors);

  if (verifiedTotpFactors.length === 0) {
    return false;
  }

  if (assurance?.nextLevel === "aal1") {
    return false;
  }

  return assurance?.currentLevel !== "aal2";
}

export function resolvePostAuthRedirectPath(
  redirectPath?: string | null,
): string {
  return normalizeRedirectPath(redirectPath) ?? "/home";
}

export function buildMfaRedirectPath(redirectPath?: string | null): string {
  const normalizedRedirect = normalizeRedirectPath(redirectPath);

  if (!normalizedRedirect) {
    return "/auth/mfa";
  }

  const url = new URLSearchParams();
  url.set("redirect", normalizedRedirect);
  return `/auth/mfa?${url.toString()}`;
}

export function deriveMfaContinuationPath(options: {
  pathname: string;
  search?: string;
  requestedRedirect?: string | null;
}): string {
  if (options.pathname === "/login") {
    return resolvePostAuthRedirectPath(options.requestedRedirect);
  }

  if (
    options.pathname === "/" ||
    options.pathname === "/signup" ||
    options.pathname === "/faq"
  ) {
    return "/home";
  }

  return resolvePostAuthRedirectPath(
    `${options.pathname}${options.search ?? ""}`,
  );
}