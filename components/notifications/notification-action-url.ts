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

  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null;
    return { kind: "internal", href: value };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.origin === currentOrigin) {
    return {
      kind: "internal",
      href: `${parsed.pathname}${parsed.search}${parsed.hash}`,
    };
  }
  if (parsed.protocol === "https:") {
    return { kind: "external", href: parsed.toString() };
  }
  return null;
}
