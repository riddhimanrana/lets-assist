// Email validation and parsing utilities for bulk imports

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function parseEmails(input: string): string[] {
  // Extract emails from arbitrary pasted text, including formats like:
  // - john@example.com
  // - John Doe <john@example.com>
  // - CSV / semicolon / newline / tab-delimited rows
  const matchedEmails = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  const emails = matchedEmails
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && isValidEmail(e));

  // Remove duplicates
  return [...new Set(emails)];
}
