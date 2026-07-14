import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = 1;
const TTL_MS = 5 * 60 * 1000;
const MINIMUM_SECRET_LENGTH = 32;

type ContinuationPayload = {
  version: typeof VERSION;
  anonymousSignupId: string;
  projectId: string;
  email: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

type ContinuationIdentity = Pick<
  ContinuationPayload,
  "anonymousSignupId" | "projectId" | "email"
>;

function getSecret() {
  const secret =
    process.env.ANONYMOUS_SIGNUP_CONTINUATION_SECRET ?? process.env.ENCRYPTION_KEY;

  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      "ANONYMOUS_SIGNUP_CONTINUATION_SECRET or ENCRYPTION_KEY must be at least 32 characters",
    );
  }

  return secret;
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`anonymous-signup-continuation:v${VERSION}:${encodedPayload}`)
    .digest("base64url");
}

function safelyEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isPayload(value: unknown): value is ContinuationPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ContinuationPayload>;

  return (
    payload.version === VERSION &&
    typeof payload.anonymousSignupId === "string" &&
    payload.anonymousSignupId.length > 0 &&
    typeof payload.projectId === "string" &&
    payload.projectId.length > 0 &&
    typeof payload.email === "string" &&
    payload.email === normalizeEmail(payload.email) &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 32 &&
    typeof payload.issuedAt === "number" &&
    Number.isSafeInteger(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isSafeInteger(payload.expiresAt)
  );
}

export function createAnonymousSignupContinuation(
  identity: ContinuationIdentity,
  options: { now?: number; secret?: string; nonce?: string } = {},
) {
  const issuedAt = options.now ?? Date.now();
  const payload: ContinuationPayload = {
    version: VERSION,
    anonymousSignupId: identity.anonymousSignupId,
    projectId: identity.projectId,
    email: normalizeEmail(identity.email),
    nonce: options.nonce ?? randomBytes(32).toString("base64url"),
    issuedAt,
    expiresAt: issuedAt + TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(encodedPayload, options.secret ?? getSecret());
  return `${encodedPayload}.${signature}`;
}

export function verifyAnonymousSignupContinuation(
  token: string | null | undefined,
  identity: ContinuationIdentity,
  options: { now?: number; secret?: string } = {},
) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  try {
    const [encodedPayload, suppliedSignature] = parts;
    const expectedSignature = signPayload(encodedPayload, options.secret ?? getSecret());
    if (!safelyEqual(suppliedSignature, expectedSignature)) return false;

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;
    if (!isPayload(payload)) return false;

    const now = options.now ?? Date.now();
    if (
      payload.issuedAt > now + 30_000 ||
      payload.expiresAt <= now ||
      payload.expiresAt - payload.issuedAt !== TTL_MS
    ) {
      return false;
    }

    return (
      safelyEqual(payload.anonymousSignupId, identity.anonymousSignupId) &&
      safelyEqual(payload.projectId, identity.projectId) &&
      safelyEqual(payload.email, normalizeEmail(identity.email))
    );
  } catch {
    return false;
  }
}
