export function normalizeRedirectPath(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  if (value.trim() !== value) {
    return null;
  }

  let candidate = value;

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Ignore decode errors and keep original candidate.
  }

  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    Array.from(candidate).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    return null;
  }

  try {
    const safeOrigin = "https://lets-assist.invalid";
    const parsed = new URL(candidate, safeOrigin);
    if (parsed.origin !== safeOrigin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function buildAuthConfirmRedirectUrl(
  origin: string,
  redirectPath?: string | null,
): string {
  const url = new URL("/auth/confirm", origin);
  const normalizedRedirect = normalizeRedirectPath(redirectPath);

  if (normalizedRedirect) {
    url.searchParams.set("redirectAfterAuth", normalizedRedirect);
  }

  return url.toString();
}
