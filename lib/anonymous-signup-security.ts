export function shouldRequireAnonymousSignupCaptcha(params: {
  hasExistingAnonymousProfile: boolean;
  skipConfirmationEmail?: boolean;
}): boolean {
  const { hasExistingAnonymousProfile, skipConfirmationEmail = false } = params;

  return !skipConfirmationEmail || !hasExistingAnonymousProfile;
}

export function shouldRenderTurnstileWidget(params?: {
  siteKey?: string | null;
  bypass?: string | null;
}): boolean {
  const { siteKey, bypass } = params ?? {};

  return Boolean(siteKey) && bypass !== "true";
}