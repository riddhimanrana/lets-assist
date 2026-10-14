const LEGACY_PROJECT_TIMEZONE = "America/Los_Angeles";

export function certificateTimezone(timeZone?: string | null): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      return timeZone;
    } catch {
      // Legacy records without a valid project zone use the existing default.
    }
  }
  return LEGACY_PROJECT_TIMEZONE;
}

function instant(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatCertificateDate(
  value?: string | null,
  timeZone?: string | null,
  style: "iso" | "display" = "iso",
): string {
  const date = instant(value);
  if (!date) return "Unknown Date";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: certificateTimezone(timeZone),
    year: "numeric",
    month: style === "display" ? "short" : "2-digit",
    day: style === "display" ? "numeric" : "2-digit",
  });
  if (style === "display") return formatter.format(date);
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatCertificateTime(
  value?: string | null,
  timeZone?: string | null,
): string {
  const date = instant(value);
  if (!date) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: certificateTimezone(timeZone),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  })
    .format(date)
    .replace(/[\u00a0\u202f]/gu, " ");
}
