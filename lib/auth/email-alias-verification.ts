import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const EMAIL_ALIAS_CODE_TTL_MS = 30 * 60 * 1_000;
export const EMAIL_ALIAS_RESEND_COOLDOWN_MS = 60 * 1_000;
export const EMAIL_ALIAS_MAX_ATTEMPTS = 5;
export const EMAIL_ALIAS_LOCKOUT_MS = 15 * 60 * 1_000;

const MINIMUM_SECRET_LENGTH = 32;

function getEmailAliasSecret(): string {
  const secret =
    process.env.EMAIL_ALIAS_VERIFICATION_SECRET ?? process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      "EMAIL_ALIAS_VERIFICATION_SECRET or ENCRYPTION_KEY must be at least 32 characters long",
    );
  }
  return secret;
}

export function normalizeEmailAlias(email: string): string {
  return email.trim().toLowerCase();
}

export function generateEmailAliasVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashEmailAliasVerificationCode(
  code: string,
  secret = getEmailAliasSecret(),
): string {
  return createHmac("sha256", secret)
    .update(`lets-assist-email-alias:${code.trim()}`)
    .digest("hex");
}

export function emailAliasHashesMatch(
  left: string,
  right: string,
): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function getEmailAliasResendDelayMs(
  lastSentAt: string | null | undefined,
  now = Date.now(),
): number {
  if (!lastSentAt) return 0;
  const sentAt = new Date(lastSentAt).getTime();
  if (!Number.isFinite(sentAt)) return 0;
  return Math.max(sentAt + EMAIL_ALIAS_RESEND_COOLDOWN_MS - now, 0);
}
