import "server-only";

import { compactVerify, createRemoteJWKSet, decodeProtectedHeader } from "jose";

import { getAdminClient } from "@/lib/supabase/admin";

const GOOGLE_RISC_CONFIG_URL =
  "https://accounts.google.com/.well-known/risc-configuration";
const GOOGLE_CAP_MAX_JTI_LENGTH = 512;
const GOOGLE_CAP_MAX_SUBJECT_LENGTH = 255;
const GOOGLE_CAP_MAX_FUTURE_SKEW_SECONDS = 5 * 60;

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

  const json = (await response.json()) as Partial<RiscConfig>;
  if (!json.issuer || !json.jwks_uri) {
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

function getAllowedClientIds(): string[] {
  const configured = process.env.GOOGLE_CAP_CLIENT_IDS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  const fallback = process.env.GOOGLE_CLIENT_ID?.trim();
  return fallback ? [fallback] : [];
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
  if (audiences.length === 0) {
    throw new Error(
      "GOOGLE_CAP_CLIENT_IDS (or GOOGLE_CLIENT_ID) is not configured",
    );
  }

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
  try {
    const { payload } = await compactVerify(token, jwks);
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payload),
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
  eventType: string,
  details: RiscEventDetails,
  expectedIssuer: string,
): string | null {
  const subject = details.subject;
  if (!subject?.sub) {
    return null;
  }

  if (
    subject.sub.length > GOOGLE_CAP_MAX_SUBJECT_LENGTH ||
    subject.sub.trim() !== subject.sub ||
    hasAsciiControlCharacter(subject.sub)
  ) {
    throw new GoogleCapValidationError("CAP token has invalid subject");
  }

  if (
    subject.iss &&
    normalizeIssuer(subject.iss) !== normalizeIssuer(expectedIssuer)
  ) {
    throw new GoogleCapValidationError("CAP token has invalid subject issuer");
  }

  return subject.sub;
}

export function getGoogleCapEventDescriptor(
  payload: DecodedGoogleCapToken,
): GoogleCapEventDescriptor {
  const [[eventType, eventDetails]] = Object.entries(payload.events);
  const googleSubject = getEventSubject(eventType, eventDetails, payload.iss);

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

async function terminateUserSessions(userId: string) {
  const admin = getAdminClient();
  const signOut = (
    admin.auth.admin as unknown as {
      signOut?: (
        userId: string,
        scope?: "global" | "local" | "others",
      ) => Promise<{ error?: { message: string } | null }>;
    }
  ).signOut;

  if (!signOut) {
    throw new Error("Supabase admin signOut API is unavailable");
  }

  const { error } = await signOut(userId, "global");
  if (error) {
    throw new Error("Failed to terminate CAP user sessions");
  }
}

function readLastStateIat(security: Record<string, unknown>): number | null {
  const value = security.google_cap_last_state_iat;
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

async function setGoogleSigninDisabled(options: {
  userId: string;
  disabled: boolean;
  reason: string;
  issuedAt: Date;
  issuedAtSeconds: number;
}): Promise<"updated" | "stale_enable_ignored" | "stale_disable_ignored"> {
  const user = await getAuthUser(options.userId);
  const admin = getAdminClient();
  const currentMetadata = user.app_metadata ?? {};
  const currentSecurity =
    currentMetadata.security && typeof currentMetadata.security === "object"
      ? (currentMetadata.security as Record<string, unknown>)
      : {};
  const lastStateIat = readLastStateIat(currentSecurity);

  if (lastStateIat !== null && options.issuedAtSeconds < lastStateIat) {
    return options.disabled ? "stale_disable_ignored" : "stale_enable_ignored";
  }

  const effectiveStateIat = Math.max(
    lastStateIat ?? 0,
    options.issuedAtSeconds,
  );
  const eventTime = options.issuedAt.toISOString();
  const nextSecurity = {
    ...currentSecurity,
    google_signin_disabled: options.disabled,
    google_signin_disabled_reason: options.disabled ? options.reason : null,
    google_signin_disabled_at: options.disabled ? eventTime : null,
    google_signin_reenabled_at: options.disabled ? null : eventTime,
    google_cap_last_state_iat: effectiveStateIat,
  };

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...currentMetadata,
      security: nextSecurity,
    },
  });

  if (error) {
    throw new Error("Failed to update CAP user security metadata");
  }

  return "updated";
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

export async function handleGoogleCapPayload(
  payload: DecodedGoogleCapToken,
  userId: string | null,
): Promise<{
  actionCount: number;
  errorCount: number;
  safeOutcome: string;
}> {
  const descriptor = getGoogleCapEventDescriptor(payload);
  const eventDetails = payload.events[descriptor.eventType];

  if (!userId) {
    return {
      actionCount: 0,
      errorCount: 0,
      safeOutcome: "no_local_user",
    };
  }

  try {
    if (
      descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.sessionsRevoked ||
      descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.tokensRevoked ||
      descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.tokenRevoked
    ) {
      await terminateUserSessions(userId);
      return {
        actionCount: 1,
        errorCount: 0,
        safeOutcome: "sessions_terminated",
      };
    }

    if (descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.accountDisabled) {
      const reason = normalizeDisabledReason(eventDetails?.reason);
      const outcome = await setGoogleSigninDisabled({
        userId,
        disabled: true,
        reason: `account_disabled_${reason}`,
        issuedAt: descriptor.issuedAt,
        issuedAtSeconds: payload.iat,
      });
      if (outcome !== "updated") {
        return {
          actionCount: 0,
          errorCount: 0,
          safeOutcome: outcome,
        };
      }

      let actionCount = 1;
      if (reason === "hijacking") {
        await terminateUserSessions(userId);
        actionCount += 1;
      }
      return {
        actionCount,
        errorCount: 0,
        safeOutcome: "google_signin_disabled",
      };
    }

    if (descriptor.eventType === GOOGLE_CAP_EVENT_TYPES.accountEnabled) {
      const outcome = await setGoogleSigninDisabled({
        userId,
        disabled: false,
        reason: "account_enabled",
        issuedAt: descriptor.issuedAt,
        issuedAtSeconds: payload.iat,
      });
      return {
        actionCount: outcome === "updated" ? 1 : 0,
        errorCount: 0,
        safeOutcome: outcome === "updated" ? "google_signin_enabled" : outcome,
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
