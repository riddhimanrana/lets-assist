export type ImportErrorCode =
  | "invalid_url"
  | "unsafe_address"
  | "timeout"
  | "too_large"
  | "redirect"
  | "unavailable"
  | "challenge"
  | "unsupported"
  | "incomplete";
export class SignUpGeniusImportError extends Error {
  constructor(public readonly code: ImportErrorCode) {
    super(code);
  }
}
export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  invalid_url:
    "Paste a public SignUpGenius /go/ event link or a mobile signup link.",
  unsafe_address:
    "This link cannot be fetched safely. Try creating your project manually.",
  timeout: "SignUpGenius took too long to respond. Please try again later.",
  too_large:
    "This signup is too large to import safely. Create your project manually.",
  redirect:
    "This signup redirected to an unsupported destination. Use its public event link.",
  unavailable:
    "We couldn't access this public signup. It may be private, removed, or temporarily unavailable.",
  challenge:
    "SignUpGenius requires a browser verification. We cannot import this signup automatically.",
  unsupported:
    "This signup's format is not supported yet. No project has been created.",
  incomplete:
    "We couldn't verify the event dates, times, and slot capacities. No project has been created. Create it manually using the original signup.",
};
