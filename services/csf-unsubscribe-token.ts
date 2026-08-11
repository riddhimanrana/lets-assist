import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Recipient unsubscribe confirmation tokens.
 *
 * The CSF campaign body is content-hashed and byte-identical for every
 * recipient, so no per-recipient token can travel in the email itself. The
 * unsubscribe page therefore runs a verify-the-address loop: the visitor types
 * an address, a TRANSACTIONAL confirmation email carries this short-lived
 * token to that address, and only the token's bearer — someone who can read
 * the inbox — can record the opt-out. The token binds organization, topic, and
 * the address (as plain lowercase form plus content for the RPC's verified
 * hash), and expires in 30 minutes.
 */

const UNSUBSCRIBE_TOKEN_VERSION = 1;
const UNSUBSCRIBE_TOKEN_TTL_MS = 30 * 60 * 1000;
const MINIMUM_SECRET_LENGTH = 32;

export type CsfUnsubscribeTokenIdentity = {
  organizationId: string;
  topicKey: string;
  recipientEmail: string;
};

type CsfUnsubscribeTokenPayload = CsfUnsubscribeTokenIdentity & {
  version: typeof UNSUBSCRIBE_TOKEN_VERSION;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function getUnsubscribeSecret() {
  const secret =
    process.env.CSF_UNSUBSCRIBE_TOKEN_SECRET ??
    process.env.CSF_PROFILE_CLAIM_SECRET ??
    process.env.ENCRYPTION_KEY;

  if (!secret || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      "CSF_UNSUBSCRIBE_TOKEN_SECRET, CSF_PROFILE_CLAIM_SECRET, or ENCRYPTION_KEY must be at least 32 characters.",
    );
  }

  return secret;
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`csf-unsubscribe:v${UNSUBSCRIBE_TOKEN_VERSION}:${encodedPayload}`)
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

function isTokenPayload(value: unknown): value is CsfUnsubscribeTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<CsfUnsubscribeTokenPayload>;
  return (
    payload.version === UNSUBSCRIBE_TOKEN_VERSION &&
    typeof payload.organizationId === "string" &&
    payload.organizationId.length > 0 &&
    typeof payload.topicKey === "string" &&
    payload.topicKey.length > 0 &&
    typeof payload.recipientEmail === "string" &&
    payload.recipientEmail === normalizeEmail(payload.recipientEmail) &&
    payload.recipientEmail.includes("@") &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 32 &&
    typeof payload.issuedAt === "number" &&
    Number.isSafeInteger(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isSafeInteger(payload.expiresAt)
  );
}

export function createCsfUnsubscribeToken(
  identity: CsfUnsubscribeTokenIdentity,
  options: { now?: number; secret?: string; nonce?: string } = {},
) {
  const issuedAt = options.now ?? Date.now();
  const payload: CsfUnsubscribeTokenPayload = {
    version: UNSUBSCRIBE_TOKEN_VERSION,
    organizationId: identity.organizationId,
    topicKey: identity.topicKey,
    recipientEmail: normalizeEmail(identity.recipientEmail),
    nonce: options.nonce ?? randomBytes(32).toString("base64url"),
    issuedAt,
    expiresAt: issuedAt + UNSUBSCRIBE_TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signPayload(
    encodedPayload,
    options.secret ?? getUnsubscribeSecret(),
  );
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify a token with no expected identity: the token IS the request. The
 * caller acts only on the payload's own organization/topic/address triple, so
 * a tampered token fails the signature and a valid one can only ever opt out
 * the address it was mailed to.
 */
export function verifyCsfUnsubscribeToken(
  token: string | null | undefined,
  options: { now?: number; secret?: string } = {},
): CsfUnsubscribeTokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  try {
    const [encodedPayload, suppliedSignature] = parts;
    const expectedSignature = signPayload(
      encodedPayload,
      options.secret ?? getUnsubscribeSecret(),
    );
    if (!safelyEqual(suppliedSignature, expectedSignature)) return null;

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;
    if (!isTokenPayload(payload)) return null;

    const now = options.now ?? Date.now();
    if (
      payload.issuedAt > now + 30_000 ||
      payload.expiresAt <= now ||
      payload.expiresAt - payload.issuedAt !== UNSUBSCRIBE_TOKEN_TTL_MS
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
