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

export function isCsfConnectRedirect(path: string | null | undefined): boolean {
  const normalized = normalizeRedirectPath(path);
  if (!normalized) {
    return false;
  }

  const pathnameOnly = normalized.split("#")[0].split("?")[0];
  const segments = pathnameOnly.split("/").filter(Boolean);

  // /organization/<slug>/plugins/dvhs-csf/connect[/<code>]
  if (segments.length !== 5 && segments.length !== 6) {
    return false;
  }

  return (
    segments[0] === "organization" &&
    segments[1].length > 0 &&
    segments[2] === "plugins" &&
    segments[3] === "dvhs-csf" &&
    segments[4] === "connect" &&
    (segments.length === 5 || segments[5].length > 0)
  );
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

export function buildCanonicalSignupPath({
  redirectPath,
  staffToken,
  orgUsername,
}: {
  redirectPath?: string | null;
  staffToken?: string | null;
  orgUsername?: string | null;
}): string {
  const params = new URLSearchParams();
  const normalizedRedirect = normalizeRedirectPath(redirectPath);

  if (normalizedRedirect) params.set("redirect", normalizedRedirect);
  if (staffToken && orgUsername) {
    params.set("staff_token", staffToken);
    params.set("org", orgUsername);
  }

  const query = params.toString();
  return query ? `/signup?${query}` : "/signup";
}
