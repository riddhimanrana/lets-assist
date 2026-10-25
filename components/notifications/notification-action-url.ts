export type NotificationActionTarget =
  { kind: "internal"; href: string } | { kind: "external"; href: string };

/**
 * Decide where a notification's action link may send the browser.
 *
 * The link is stored data, so it is never handed to the router as is. A path
 * on this site navigates in place. An https link to another site opens in a
 * new tab with no opener. Everything else (protocol-relative links, other
 * schemes such as javascript: or data:, malformed values) is refused.
 */
export function resolveNotificationAction(
  actionUrl: string | null | undefined,
  currentOrigin: string,
): NotificationActionTarget | null {
  const value = actionUrl?.trim();
  if (!value) return null;
  // Control characters and backslashes are how a "path" turns into a host.
  if (
    value.includes("\\") ||
    [...value].some((char) => {
      const code = char.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  ) {
    return null;
  }

  // Parse once, the way the browser will, and decide from the parsed result.
  // Checking the raw string and then navigating to it would let a value such
  // as "/.//host" or "https://this-site//host" pass as a path here and be
  // normalised into another host later.
  const isRelative = value.startsWith("/") && !value.startsWith("//");
  let parsed: URL;
  try {
    parsed = isRelative ? new URL(value, currentOrigin) : new URL(value);
  } catch {
    return null;
  }

  if (parsed.origin === currentOrigin) {
    const href = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    // The normalised path must itself be a plain site path.
    if (!href.startsWith("/") || href.startsWith("//")) return null;
    return { kind: "internal", href };
  }
  if (isRelative) return null;
  if (parsed.protocol === "https:" && !parsed.username && !parsed.password) {
    return { kind: "external", href: parsed.toString() };
  }
  return null;
}
