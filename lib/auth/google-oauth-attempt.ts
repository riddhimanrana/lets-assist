/**
 * Primitives for one Google OAuth authorization attempt.
 *
 * The old model put the entire request in a single browser cookie holding one
 * nonce, shared by every purpose. A second connect click -- another tab, a
 * re-click, a Picker reconnect started while a Calendar connect was open --
 * overwrote it, so the first callback failed and collapsed to `invalid_state`.
 *
 * Here the browser holds two unguessable secrets and nothing else:
 *   * the `state` Google echoes back, `v3.<attemptRef>.<stateSecret>`;
 *   * an attempt-specific cookie named for that same `attemptRef`.
 *
 * Only SHA-256 digests of both secrets reach the database, so the durable
 * ledger cannot be used to forge a callback, and two attempts can never
 * collide because their cookie names differ. Everything else -- purpose,
 * capability, organization, return route, PKCE verifier -- lives server-side.
 *
 * This module is deliberately dependency-free and pure so the state machine
 * can be tested without a database or a request.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { resolveGoogleOAuthCallbackPath } from "./google-oauth-callback-path";

/** How long an authorization request stays completable. */
export const GOOGLE_OAUTH_ATTEMPT_TTL_SECONDS = 10 * 60;

/**
 * How long one callback may hold the exchange before another may recover it.
 * Long enough for the token, userinfo, and persistence round trips; short
 * enough that a crashed handler does not block a retry for long.
 */
export const GOOGLE_OAUTH_ATTEMPT_LEASE_SECONDS = 120;

const STATE_VERSION = "v3";
const ATTEMPT_REF_BYTES = 18; // 24 base64url characters
const SECRET_BYTES = 32; // 43 base64url characters
const COOKIE_NAME_PREFIX = "la_goauth_";
const CORRELATION_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
const CORRELATION_LENGTH = 10;
const CORRELATION_MASK = CORRELATION_ALPHABET.length - 1;
const SECRET_DIGEST_DOMAIN = "lets-assist/google-oauth-attempt/v1";

export type GoogleOAuthAttemptSecrets = {
  attemptRef: string;
  /** Sent to Google as `state`. Never stored. */
  state: string;
  /** Set as the attempt-specific cookie value. Never stored. */
  cookieSecret: string;
  cookieName: string;
  stateDigest: string;
  cookieDigest: string;
  codeVerifier: string;
  codeChallenge: string;
  correlationId: string;
};

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

/**
 * Keyed SHA-256, base64url. 43 characters, matching the ledger's CHECK.
 *
 * The attempt values already carry 256 bits of entropy, but a keyed digest
 * also prevents an exported ledger from becoming an offline verifier. The
 * environment key is mandatory in every runtime that can start or complete an
 * OAuth attempt.
 */
export function digestGoogleOAuthSecret(secret: string): string {
  const digestKey = process.env.ENCRYPTION_KEY;
  if (!digestKey || digestKey.length < 32) {
    throw new Error(
      "ENCRYPTION_KEY must contain at least 32 characters for Google OAuth attempt digests.",
    );
  }

  return base64Url(
    createHmac("sha256", digestKey)
      .update(SECRET_DIGEST_DOMAIN, "utf8")
      .update("\0", "utf8")
      .update(secret, "utf8")
      .digest(),
  );
}

/**
 * A short operator-facing code. It identifies one attempt in the ledger and in
 * server logs without carrying the user, organization, or any provider value,
 * so it is safe to print in the UI and to paste into a support thread.
 */
export function createGoogleOAuthCorrelationId(): string {
  const bytes = randomBytes(CORRELATION_LENGTH);
  let code = "";
  for (const byte of bytes) {
    // The alphabet has exactly 32 symbols, so masking five random bits is
    // uniform and avoids modulo-bias constructions entirely.
    code += CORRELATION_ALPHABET[byte & CORRELATION_MASK];
  }
  return code;
}

export function getGoogleOAuthAttemptCookieName(attemptRef: string): string {
  return `${COOKIE_NAME_PREFIX}${attemptRef}`;
}

/**
 * Cookie options for one attempt.
 *
 * `path` stays on the callback route so the cookie is not attached to ordinary
 * navigation, and `sameSite: lax` still allows Google's top-level redirect back
 * to carry it. The name is attempt-specific, so unlike the previous single
 * cookie a concurrent attempt cannot overwrite this one.
 */
export function getGoogleOAuthAttemptCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: resolveGoogleOAuthCallbackPath(),
    maxAge: GOOGLE_OAUTH_ATTEMPT_TTL_SECONDS,
  };
}

/**
 * RFC 7636 S256. The verifier is 43 base64url characters, inside the 43-128
 * range Google accepts, and the challenge is its SHA-256 digest. Only the
 * challenge travels to the authorization endpoint; the verifier is released
 * from the ledger once, to the one callback that claims the attempt.
 */
export function createGoogleOAuthPkcePair(): {
  codeVerifier: string;
  codeChallenge: string;
} {
  const codeVerifier = base64Url(randomBytes(SECRET_BYTES));
  return {
    codeVerifier,
    codeChallenge: deriveGoogleOAuthPkceChallenge(codeVerifier),
  };
}

/** RFC 7636 requires this exact fast S256 transform, not a password KDF. */
export function deriveGoogleOAuthPkceChallenge(codeVerifier: string): string {
  return base64Url(createHash("sha256").update(codeVerifier, "ascii").digest());
}

export function createGoogleOAuthAttemptSecrets(): GoogleOAuthAttemptSecrets {
  const attemptRef = base64Url(randomBytes(ATTEMPT_REF_BYTES));
  const stateSecret = base64Url(randomBytes(SECRET_BYTES));
  const cookieSecret = base64Url(randomBytes(SECRET_BYTES));
  const { codeVerifier, codeChallenge } = createGoogleOAuthPkcePair();

  return {
    attemptRef,
    state: `${STATE_VERSION}.${attemptRef}.${stateSecret}`,
    cookieSecret,
    cookieName: getGoogleOAuthAttemptCookieName(attemptRef),
    stateDigest: digestGoogleOAuthSecret(stateSecret),
    cookieDigest: digestGoogleOAuthSecret(cookieSecret),
    codeVerifier,
    codeChallenge,
    correlationId: createGoogleOAuthCorrelationId(),
  };
}

export type ParsedGoogleOAuthState = {
  attemptRef: string;
  stateDigest: string;
  cookieName: string;
};

const ATTEMPT_REF_PATTERN = /^[A-Za-z0-9_-]{16,64}$/u;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * Parse the state Google echoed back. This proves only that the value is
 * well-formed; whether it names a live attempt is decided by the ledger claim,
 * which is the single authority.
 */
export function parseGoogleOAuthState(
  state: string | null | undefined,
): ParsedGoogleOAuthState | null {
  if (!state) return null;

  const parts = state.split(".");
  if (parts.length !== 3) return null;

  const [version, attemptRef, stateSecret] = parts;
  if (version !== STATE_VERSION) return null;
  if (!ATTEMPT_REF_PATTERN.test(attemptRef)) return null;
  if (!SECRET_PATTERN.test(stateSecret)) return null;

  return {
    attemptRef,
    stateDigest: digestGoogleOAuthSecret(stateSecret),
    cookieName: getGoogleOAuthAttemptCookieName(attemptRef),
  };
}

/** Constant-time comparison for equal-length secrets. */
export function secretsMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

/**
 * Bind the attempt to the signed-in session, not only to the user.
 *
 * The binding value is the verified `session_id` claim, which is stable for
 * the life of a Supabase session and changes on re-authentication. Access and
 * refresh tokens rotate, so binding to either would fail a callback whose
 * token happened to refresh mid-flow; `session_id` does not.
 *
 * Only the digest is stored, and the browser is never given anything new to
 * keep. A callback presented after a re-login therefore fails closed instead
 * of attaching a credential to a session that did not request it.
 */
export function digestGoogleOAuthSessionBinding(
  sessionId: string | null | undefined,
): string | null {
  const normalized = sessionId?.trim();
  if (!normalized) return null;
  return digestGoogleOAuthSecret(`session:${normalized}`);
}
