import formatterTimezones from "./formatter-timezones.json";

// Reviewed names accepted by the pinned Node 24 formatter, including legacy
// aliases and fixed-offset zones. Migration 729 pins this exact set for direct
// database writes. New runtime names need a shared review.
const storedTimezones = new Set<string>(formatterTimezones);

export function canonicalCertificateTimezone(input: string): string | null {
  if (!input || input.length > 100 || input.trim() !== input) return null;
  try {
    const canonical = new Intl.DateTimeFormat("en-US", {
      timeZone: input,
    }).resolvedOptions().timeZone;
    return storedTimezones.has(canonical) ? canonical : null;
  } catch {
    return null;
  }
}
