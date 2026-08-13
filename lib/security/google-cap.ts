import "server-only";

import { randomBytes } from "node:crypto";

import {
  compactVerify,
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors,
} from "jose";

import { getAdminClient } from "@/lib/supabase/admin";

const GOOGLE_RISC_CONFIG_URL =
  "https://accounts.google.com/.well-known/risc-configuration";
const GOOGLE_CAP_MAX_JTI_LENGTH = 512;
const GOOGLE_CAP_MAX_SUBJECT_LENGTH = 255;
const GOOGLE_CAP_MAX_FUTURE_SKEW_SECONDS = 5 * 60;
const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_CAP_ENVIRONMENTS = new Set([
  "development",
  "local",
  "preview",
  "production",
]);

export const GOOGLE_CAP_EVENT_TYPES = {
  sessionsRevoked:
    "https://schemas.openid.net/secevent/risc/event-type/sessions-revoked",
  tokensRevoked:
    "https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked",
  tokenRevoked:
    "https://schemas.openid.net/secevent/oauth/event-type/token-revoked",
  accountDisabled:
    "https://schemas.openid.net/secevent/risc/event-type/account-disabled",
  accountEnabled:
    "https://schemas.openid.net/secevent/risc/event-type/account-enabled",
  accountCredentialChangeRequired:
    "https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required",
  verification:
    "https://schemas.openid.net/secevent/risc/event-type/verification",
} as const;

const USER_SUBJECT_EVENT_TYPES = new Set<string>([
  GOOGLE_CAP_EVENT_TYPES.sessionsRevoked,
  GOOGLE_CAP_EVENT_TYPES.tokensRevoked,
  GOOGLE_CAP_EVENT_TYPES.tokenRevoked,
  GOOGLE_CAP_EVENT_TYPES.accountDisabled,
  GOOGLE_CAP_EVENT_TYPES.accountEnabled,
  GOOGLE_CAP_EVENT_TYPES.accountCredentialChangeRequired,
]);

type RiscConfig = {
  issuer: string;
  jwks_uri: string;
};

type RiscEventDetails = {
  subject?: {
    subject_type?: string;
    iss?: string;
    sub?: string;
    email?: string;
  };
  reason?: string;
  state?: string;
  [key: string]: unknown;
};

export type DecodedGoogleCapToken = {
  iss: string;
  aud: string | string[];
  iat: number;
  jti: string;
  events: Record<string, RiscEventDetails>;
};

export type GoogleCapEventDescriptor = {
  issuer: string;
  jti: string;
  issuedAt: Date;
  eventType: string;
  googleSubject: string | null;
};

type CapUserRecord = {
  id: string;
  app_metadata?: Record<string, unknown> | null;
};

export class GoogleCapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCapValidationError";
  }
}

function normalizeIssuer(value: string) {
  return value.replace(/\/+$/u, "");
}

let cachedRiscConfig: { value: RiscConfig; fetchedAt: number } | null = null;

async function getRiscConfig(): Promise<RiscConfig> {
  const now = Date.now();
  if (cachedRiscConfig && now - cachedRiscConfig.fetchedAt < 60 * 60 * 1000) {
    return cachedRiscConfig.value;
  }

  const response = await fetch(GOOGLE_RISC_CONFIG_URL, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google RISC config: ${response.status}`);
  }

  const json: unknown = await response.json();
  if (
    !isPlainObject(json) ||
    typeof json.issuer !== "string" ||
    typeof json.jwks_uri !== "string" ||
    normalizeIssuer(json.issuer) !== GOOGLE_ISSUER
  ) {
    throw new Error("Google RISC config is missing issuer or jwks_uri");
  }

  const jwksUrl = new URL(json.jwks_uri);
  if (
    jwksUrl.protocol !== "https:" ||
    jwksUrl.hostname !== "www.googleapis.com"
  ) {
    throw new Error("Google RISC config returned an unexpected JWKS origin");
  }

  const value = { issuer: json.issuer, jwks_uri: jwksUrl.toString() };
  cachedRiscConfig = { value, fetchedAt: now };
  return value;
}

function getCapEnvironment(): string {
  const runtimeEnvironment =
    process.env.VERCEL_ENV?.trim().toLowerCase() || "local";
  if (!GOOGLE_CAP_ENVIRONMENTS.has(runtimeEnvironment)) {
    throw new Error("Google CAP runtime environment is unsupported");
  }

  const configuredEnvironment = process.env.GOOGLE_CAP_ENVIRONMENT?.trim();
  if (!configuredEnvironment) {
    throw new Error("GOOGLE_CAP_ENVIRONMENT is not configured");
  }
  if (configuredEnvironment !== runtimeEnvironment) {
    throw new Error("GOOGLE_CAP_ENVIRONMENT does not match this runtime");
  }
  return runtimeEnvironment;
}

function getAllowedClientIds(): string[] {
  getCapEnvironment();
  const configured = process.env.GOOGLE_CAP_CLIENT_IDS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (
    !configured ||
    configured.length === 0 ||
    configured.length > 20 ||
    new Set(configured).size !== configured.length ||
    configured.some(
      (value) =>
        value.length > 512 ||
        value.length < 1 ||
        hasAsciiControlCharacter(value),
    )
  ) {
    throw new Error(
      "GOOGLE_CAP_CLIENT_IDS is not configured for this environment",
    );
  }

  return configured;
}

function audienceMatches(aud: string | string[], expectedAudiences: string[]) {
  const values = Array.isArray(aud) ? aud : [aud];
  return values.some((value) => expectedAudiences.includes(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype,
  );
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function assertDecodedTokenShape(
  decoded: Partial<DecodedGoogleCapToken>,
): asserts decoded is DecodedGoogleCapToken {
  if (
    typeof decoded.iss !== "string" ||
    decoded.iss.length < 1 ||
    decoded.iss.length > 512 ||
    decoded.iss.trim() !== decoded.iss ||
    hasAsciiControlCharacter(decoded.iss) ||
    (typeof decoded.aud !== "string" && !Array.isArray(decoded.aud)) ||
    !Number.isSafeInteger(decoded.iat) ||
    (decoded.iat ?? 0) < 0 ||
    typeof decoded.jti !== "string" ||
    decoded.jti.length < 1 ||
    decoded.jti.length > GOOGLE_CAP_MAX_JTI_LENGTH ||
    decoded.jti.trim() !== decoded.jti ||
    !isPlainObject(decoded.events)
  ) {
    throw new GoogleCapValidationError(
      "CAP token is missing required bounded claims",
    );
  }

  const audiences = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
  if (
    audiences.length < 1 ||
    audiences.length > 20 ||
    audiences.some(
      (audience) =>
        typeof audience !== "string" ||
        audience.length < 1 ||
        audience.length > 512,
    )
  ) {
    throw new GoogleCapValidationError("CAP token has invalid audience claims");
  }

  const entries = Object.entries(decoded.events);
  if (entries.length !== 1) {
    throw new GoogleCapValidationError(
      "CAP token must describe exactly one security event",
    );
  }

  const [eventType, details] = entries[0];
  if (
    eventType.length < 1 ||
    eventType.length > 255 ||
    !eventType.startsWith("https://schemas.openid.net/secevent/") ||
    !isPlainObject(details)
  ) {
    throw new GoogleCapValidationError("CAP token has invalid event claims");
  }
}

export async function validateGoogleCapToken(
  token: string,
): Promise<DecodedGoogleCapToken> {
  const audiences = getAllowedClientIds();

  const { issuer, jwks_uri: jwksUri } = await getRiscConfig();
  let protectedHeader: ReturnType<typeof decodeProtectedHeader>;
  try {
    protectedHeader = decodeProtectedHeader(token);
  } catch {
    throw new GoogleCapValidationError(
      "CAP token has an invalid signing header",
    );
  }
  if (!protectedHeader.kid || protectedHeader.alg !== "RS256") {
    throw new GoogleCapValidationError(
      "CAP token has an invalid signing header",
    );
  }

  const jwks = createRemoteJWKSet(new URL(jwksUri));
  let decoded: Partial<DecodedGoogleCapToken>;
  let verifiedPayload: Uint8Array;
  try {
    const { payload } = await compactVerify(token, jwks);
    verifiedPayload = payload;
  } catch (error) {
    if (
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWSSignatureVerificationFailed ||
      error instanceof errors.JWKSNoMatchingKey
    ) {
      throw new GoogleCapValidationError(
        "CAP token signature or payload is invalid",
      );
    }
    // Remote JWKS timeouts, network failures, non-200 responses, and malformed
    // JWKS documents are operational failures. Let the route return 503 so a
    // valid non-expiring Security Event Token is not discarded.
    throw error;
  }

  try {
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(verifiedPayload),
    );
    decoded = isPlainObject(parsed)
      ? (parsed as Partial<DecodedGoogleCapToken>)
      : {};
  } catch {
    throw new GoogleCapValidationError(
      "CAP token signature or payload is invalid",
    );
  }

  assertDecodedTokenShape(decoded);

  if (normalizeIssuer(decoded.iss) !== normalizeIssuer(issuer)) {
    throw new GoogleCapValidationError("CAP token has invalid issuer");
  }

  if (!audienceMatches(decoded.aud, audiences)) {
    throw new GoogleCapValidationError("CAP token has invalid audience");
  }

  if (
    decoded.iat >
    Math.floor(Date.now() / 1000) + GOOGLE_CAP_MAX_FUTURE_SKEW_SECONDS
  ) {
    throw new GoogleCapValidationError("CAP token was issued in the future");
  }

  return decoded;
}

function getEventSubject(
  details: RiscEventDetails,
  expectedIssuer: string,
): string | null {
  const subject = details.subject;
  if (subject === undefined) {
    return null;
  }

  if (
    !isPlainObject(subject) ||
    subject.subject_type !== "iss-sub" ||
    typeof subject.iss !== "string" ||
    typeof subject.sub !== "string" ||
    subject.sub.length < 1 ||
    subject.sub.length > GOOGLE_CAP_MAX_SUBJECT_LENGTH ||
    subject.sub.trim() !== subject.sub ||
    hasAsciiControlCharacter(subject.sub) ||
    subject.iss.length < 1 ||
    subject.iss.length > 512 ||
    subject.iss.trim() !== subject.iss ||
    hasAsciiControlCharacter(subject.iss)
  ) {
    throw new GoogleCapValidationError("CAP token has invalid subject");
  }

  if (normalizeIssuer(subject.iss) !== normalizeIssuer(expectedIssuer)) {
    throw new GoogleCapValidationError("CAP token has invalid subject issuer");
  }

  return subject.sub;
}

export function getGoogleCapEventDescriptor(
  payload: DecodedGoogleCapToken,
): GoogleCapEventDescriptor {
  const [[eventType, eventDetails]] = Object.entries(payload.events);
  const googleSubject = getEventSubject(eventDetails, payload.iss);

  if (USER_SUBJECT_EVENT_TYPES.has(eventType) && !googleSubject) {
    throw new GoogleCapValidationError(
      "CAP event is missing its required user subject",
    );
  }

  return {
    issuer: payload.iss,
    jti: payload.jti,
    issuedAt: new Date(payload.iat * 1000),
    eventType,
    googleSubject,
  };
}

export function googleCapEventRequiresAuthEffect(eventType: string): boolean {
  return USER_SUBJECT_EVENT_TYPES.has(eventType);
}

async function getAuthUser(userId: string): Promise<CapUserRecord> {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    throw new Error("Failed to load the local CAP user");
  }

  return {
    id: data.user.id,
    app_metadata:
      data.user.app_metadata && typeof data.user.app_metadata === "object"
        ? (data.user.app_metadata as Record<string, unknown>)
        : null,
  };
}

type AuthMutationResult = "failed" | "succeeded" | "unknown";

async function updateAuthUser(
  userId: string,
  attributes: Record<string, unknown>,
): Promise<AuthMutationResult> {
  const admin = getAdminClient();
  try {
    const { error } = await admin.auth.admin.updateUserById(userId, attributes);
    if (!error) return "succeeded";
    const status =
      "status" in error && typeof error.status === "number" ? error.status : 0;
    return status >= 400 && status < 500 ? "failed" : "unknown";
  } catch {
    return "unknown";
  }
}

function replacementPassword(): string {
  // Supabase Auth has no supported admin logout-by-user-id endpoint. Its
  // supported admin password update path calls GoTrue's global Logout for the
  // target UUID. The unpersisted random credential cannot be used to sign in.
  return randomBytes(48).toString("base64url");
}

function readLastStateIat(security: Record<string, unknown>): number | null {
  const value = security.google_cap_last_state_iat;
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function readLastStateRank(security: Record<string, unknown>): number {
  const rank = security.google_cap_last_state_rank;
  if (Number.isSafeInteger(rank) && (rank as number) >= 0) {
    return rank as number;
  }
  if (security.google_signin_disabled !== true) return 0;
  switch (security.google_signin_disabled_reason) {
    case "credential_change_required":
      return 40;
    case "account_disabled_hijacking":
      return 30;
    case "account_disabled_bulk_account":
      return 20;
    default:
      return 10;
  }
}

type StateUpdate = {
  attributes: Record<string, unknown>;
  metadataChanged: boolean;
  staleOutcome: "stale_enable_ignored" | "stale_disable_ignored";
};

async function buildGoogleSigninStateUpdate(options: {
  userId: string;
  disabled: boolean;
  reason: string;
  rank: number;
  revokeSessions: boolean;
  issuedAt: Date;
  issuedAtSeconds: number;
}): Promise<StateUpdate> {
  const user = await getAuthUser(options.userId);
  const currentMetadata = user.app_metadata ?? {};
  const currentSecurity =
    currentMetadata.security && typeof currentMetadata.security === "object"
      ? (currentMetadata.security as Record<string, unknown>)
      : {};
  const lastStateIat = readLastStateIat(currentSecurity);
  const lastStateRank = readLastStateRank(currentSecurity);
  const staleOutcome = options.disabled
    ? "stale_disable_ignored"
    : "stale_enable_ignored";
  const isStale =
    lastStateIat !== null &&
    (options.issuedAtSeconds < lastStateIat ||
      (options.issuedAtSeconds === lastStateIat &&
        options.rank <= lastStateRank));
  const attributes: Record<string, unknown> = {};

  if (options.revokeSessions) {
    attributes.password = replacementPassword();
  }

  if (!isStale) {
    const eventTime = options.issuedAt.toISOString();
    attributes.app_metadata = {
      ...currentMetadata,
      security: {
        ...currentSecurity,
        google_signin_disabled: options.disabled,
        google_signin_disabled_reason: options.disabled ? options.reason : null,
        google_signin_disabled_at: options.disabled ? eventTime : null,
        google_signin_reenabled_at: options.disabled ? null : eventTime,
        google_cap_last_state_iat: options.issuedAtSeconds,
        google_cap_last_state_rank: options.rank,
      },
    };
  }

  return {
    attributes,
    metadataChanged: !isStale,
    staleOutcome,
  };
}

export function getGoogleSigninCapRestriction(metadata: unknown): {
  disabled: boolean;
  reason: string | null;
} {
  if (!metadata || typeof metadata !== "object") {
    return { disabled: false, reason: null };
  }

  const asRecord = metadata as Record<string, unknown>;
  const security =
    asRecord.security && typeof asRecord.security === "object"
      ? (asRecord.security as Record<string, unknown>)
      : null;

  if (!security || security.google_signin_disabled !== true) {
    return { disabled: false, reason: null };
  }

  const reason =
    typeof security.google_signin_disabled_reason === "string"
      ? security.google_signin_disabled_reason
      : null;

  return { disabled: true, reason };
}

function normalizeDisabledReason(
  reason: unknown,
): "hijacking" | "bulk_account" | "unspecified" {
  if (reason === "hijacking") return "hijacking";
  if (reason === "bulk-account") return "bulk_account";
  return "unspecified";
}

type GoogleCapHandleResult = {
  actionCount: number;
  errorCount: number;
  safeOutcome: string;
  settlement?: "hold";
};

function failedAuthMutation(
  result: AuthMutationResult,
): GoogleCapHandleResult | null {
  if (result === "succeeded") return null;
  if (result === "unknown") {
    return {
      actionCount: 0,
      errorCount: 1,
      safeOutcome: "auth_outcome_unknown",
      settlement: "hold",
    };
  }
  return {
    actionCount: 0,
    errorCount: 1,
    safeOutcome: "retryable_failure",
  };
}

export async function handleGoogleCapPayload(
  payload: DecodedGoogleCapToken,
  userId: string | null,
): Promise<GoogleCapHandleResult> {
  const descriptor = getGoogleCapEventDescriptor(payload);
  const eventDetails = payload.events[descriptor.eventType];

  if (googleCapEventRequiresAuthEffect(descriptor.eventType) && !userId) {
    return {
      actionCount: 0,
      errorCount: 1,
      safeOutcome: "no_local_user",
    };
  }

  try {
    if (
      descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.sessionsRevoked ||
      descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.tokensRevoked ||
      descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.tokenRevoked
    ) {
      const mutation = await updateAuthUser(userId as string, {
        password: replacementPassword(),
      });
      const failed = failedAuthMutation(mutation);
      if (failed) return failed;
      return {
        actionCount: 1,
        errorCount: 0,
        safeOutcome: "sessions_terminated",
      };
    }

    if (descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.accountDisabled) {
      const reason = normalizeDisabledReason(eventDetails?.reason);
      const rank =
        reason === "hijacking" ? 30 : reason === "bulk_account" ? 20 : 10;
      const state = await buildGoogleSigninStateUpdate({
        userId: userId as string,
        disabled: true,
        reason: `account_disabled_${reason}`,
        rank,
        revokeSessions: reason === "hijacking",
        issuedAt: descriptor.issuedAt,
        issuedAtSeconds: payload.iat,
      });
      if (Object.keys(state.attributes).length === 0) {
        return {
          actionCount: 0,
          errorCount: 0,
          safeOutcome: state.staleOutcome,
        };
      }

      const mutation = await updateAuthUser(userId as string, state.attributes);
      const failed = failedAuthMutation(mutation);
      if (failed) return failed;
      const sessionsRevoked = reason === "hijacking";
      return {
        actionCount: Number(state.metadataChanged) + Number(sessionsRevoked),
        errorCount: 0,
        safeOutcome: state.metadataChanged
          ? "google_signin_disabled"
          : "stale_disable_sessions_terminated",
      };
    }

    if (descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.accountEnabled) {
      const state = await buildGoogleSigninStateUpdate({
        userId: userId as string,
        disabled: false,
        reason: "account_enabled",
        rank: 0,
        revokeSessions: false,
        issuedAt: descriptor.issuedAt,
        issuedAtSeconds: payload.iat,
      });
      if (!state.metadataChanged) {
        return {
          actionCount: 0,
          errorCount: 0,
          safeOutcome: state.staleOutcome,
        };
      }

      const mutation = await updateAuthUser(userId as string, state.attributes);
      const failed = failedAuthMutation(mutation);
      if (failed) return failed;
      return {
        actionCount: 1,
        errorCount: 0,
        safeOutcome: "google_signin_enabled",
      };
    }

    if (
      descriptor.eventType ===
      GOOGLE_CAP_EVENT_TYPES.accountCredentialChangeRequired
    ) {
      const state = await buildGoogleSigninStateUpdate({
        userId: userId as string,
        disabled: true,
        reason: "credential_change_required",
        rank: 40,
        revokeSessions: true,
        issuedAt: descriptor.issuedAt,
        issuedAtSeconds: payload.iat,
      });
      const mutation = await updateAuthUser(userId as string, state.attributes);
      const failed = failedAuthMutation(mutation);
      if (failed) return failed;
      return {
        actionCount: Number(state.metadataChanged) + 1,
        errorCount: 0,
        safeOutcome: state.metadataChanged
          ? "credential_change_required"
          : "stale_disable_sessions_terminated",
      };
    }

    if (descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.verification) {
      return {
        actionCount: 0,
        errorCount: 0,
        safeOutcome: "verification_acknowledged",
      };
    }

    return {
      actionCount: 0,
      errorCount: 0,
      safeOutcome: "event_acknowledged",
    };
  } catch {
    return {
      actionCount: 0,
      errorCount: 1,
      safeOutcome: "retryable_failure",
    };
  }
}
