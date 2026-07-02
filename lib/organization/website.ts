export function formatOrganizationWebsiteDisplay(website: string) {
  const normalized = website.startsWith("http://") || website.startsWith("https://")
    ? website
    : `https://${website}`;

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.replace(/^www\./, "");
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");

    return `${hostname}${pathname}`;
  } catch {
    return website
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/$/, "");
  }
}
