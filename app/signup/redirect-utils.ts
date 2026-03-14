export function normalizeRedirectPath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  let candidate = value.trim();
  if (!candidate) {
    return null;
  }

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Ignore decode errors and keep original candidate.
  }

  if (!candidate.startsWith("/")) {
    return null;
  }

  if (candidate.startsWith("//")) {
    return null;
  }

  return candidate;
}

export function buildAuthConfirmRedirectUrl(origin: string, redirectPath?: string | null): string {
  const url = new URL("/auth/confirm", origin);
  const normalizedRedirect = normalizeRedirectPath(redirectPath);

  if (normalizedRedirect) {
    url.searchParams.set("redirectAfterAuth", normalizedRedirect);
  }

  return url.toString();
}