import { compactVerify, createRemoteJWKSet, decodeProtectedHeader } from "jose";
import { getAdminClient } from "@/lib/supabase/admin";

const GOOGLE_RISC_CONFIG_URL = "https://accounts.google.com/.well-known/risc-configuration";

const EVENT_TYPES = {
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
  iat?: number;
  jti?: string;
  events: Record<string, RiscEventDetails>;
};

type CapUserRecord = {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

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

  const value = { issuer: json.issuer, jwks_uri: json.jwks_uri };
  cachedRiscConfig = { value, fetchedAt: now };
  return value;
}

function getAllowedClientIds(): string[] {
  const configured = process.env.GOOGLE_CAP_CLIENT_IDS
    ?.split(",")
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

export async function validateGoogleCapToken(token: string): Promise<DecodedGoogleCapToken> {
  const audiences = getAllowedClientIds();
  if (audiences.length === 0) {
    throw new Error("GOOGLE_CAP_CLIENT_IDS (or GOOGLE_CLIENT_ID) is not configured");
  }

  const { issuer, jwks_uri: jwksUri } = await getRiscConfig();
  const protectedHeader = decodeProtectedHeader(token);
  if (!protectedHeader.kid) {
    throw new Error("CAP token is missing key id (kid)");
  }

  const jwks = createRemoteJWKSet(new URL(jwksUri));
  const { payload } = await compactVerify(token, jwks);
  const decoded = JSON.parse(new TextDecoder().decode(payload)) as Partial<DecodedGoogleCapToken>;

  if (!decoded.iss || !decoded.aud || !decoded.events || typeof decoded.events !== "object") {
    throw new Error("CAP token is missing required claims");
  }

  if (normalizeIssuer(decoded.iss) !== normalizeIssuer(issuer)) {
    throw new Error("CAP token has invalid issuer");
  }

  if (!audienceMatches(decoded.aud, audiences)) {
    throw new Error("CAP token has invalid audience");
  }

  return decoded as DecodedGoogleCapToken;
}

function getEventSubjects(payload: DecodedGoogleCapToken, expectedIssuer: string): string[] {
  const subjects = new Set<string>();

  for (const details of Object.values(payload.events)) {
    const subject = details?.subject;
    if (!subject?.sub) {
      continue;
    }

    if (subject.iss && normalizeIssuer(subject.iss) !== normalizeIssuer(expectedIssuer)) {
      continue;
    }

    subjects.add(subject.sub);
  }

  return [...subjects];
}

async function findUserByGoogleSubject(googleSub: string): Promise<CapUserRecord | null> {
  const admin = getAdminClient();
  const perPage = 100;
  const maxPages = 100;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to list users: ${error.message}`);
    }

    const users = data?.users ?? [];
    for (const user of users) {
      const identities = user.identities ?? [];
      const isMatch = identities.some((identity) => {
        if (identity.provider !== "google") {
          return false;
        }

        const identityData =
          identity.identity_data && typeof identity.identity_data === "object"
            ? (identity.identity_data as Record<string, unknown>)
            : null;

        return identityData?.sub === googleSub;
      });

      if (isMatch) {
        return {
          id: user.id,
          email: user.email,
          app_metadata:
            user.app_metadata && typeof user.app_metadata === "object"
              ? (user.app_metadata as Record<string, unknown>)
              : null,
        };
      }
    }

    if (users.length < perPage) {
      break;
    }
  }

  return null;
}

async function terminateUserSessions(userId: string) {
  const admin = getAdminClient();

  const signOut = (
    admin.auth.admin as unknown as {
      signOut?: (userId: string, scope?: "global" | "local" | "others") => Promise<{ error?: { message: string } | null }>;
    }
  ).signOut;

  if (!signOut) {
    throw new Error("Supabase admin signOut API is unavailable");
  }

  const { error } = await signOut(userId, "global");
  if (error) {
    throw new Error(`Failed to terminate sessions: ${error.message}`);
  }
}

async function setGoogleSigninDisabled(
  user: CapUserRecord,
  disabled: boolean,
  reason: string,
) {
  const admin = getAdminClient();
  const currentMetadata = user.app_metadata ?? {};
  const currentSecurity =
    currentMetadata.security && typeof currentMetadata.security === "object"
      ? (currentMetadata.security as Record<string, unknown>)
      : {};

  const nextSecurity = {
    ...currentSecurity,
    google_signin_disabled: disabled,
    google_signin_disabled_reason: disabled ? reason : null,
    google_signin_disabled_at: disabled ? new Date().toISOString() : null,
    google_signin_reenabled_at: disabled ? null : new Date().toISOString(),
  };

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...currentMetadata,
      security: nextSecurity,
    },
  });

  if (error) {
    throw new Error(`Failed to update user CAP metadata: ${error.message}`);
  }
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

  const reason = typeof security.google_signin_disabled_reason === "string"
    ? security.google_signin_disabled_reason
    : null;

  return { disabled: true, reason };
}

export async function handleGoogleCapPayload(payload: DecodedGoogleCapToken) {
  const { issuer } = await getRiscConfig();
  const subjects = getEventSubjects(payload, issuer);

  const results: Array<{
    subject: string;
    userId: string | null;
    actions: string[];
    errors: string[];
  }> = [];

  for (const subject of subjects) {
    const entry = {
      subject,
      userId: null as string | null,
      actions: [] as string[],
      errors: [] as string[],
    };

    const user = await findUserByGoogleSubject(subject);
    if (!user) {
      entry.errors.push("No local user linked to this Google subject");
      results.push(entry);
      continue;
    }

    entry.userId = user.id;

    for (const [eventType, eventDetails] of Object.entries(payload.events)) {
      try {
        if (
          eventType === EVENT_TYPES.sessionsRevoked ||
          eventType === EVENT_TYPES.tokensRevoked
        ) {
          await terminateUserSessions(user.id);
          entry.actions.push(`sessions_terminated:${eventType}`);
          continue;
        }

        if (eventType === EVENT_TYPES.accountDisabled) {
          const reason = eventDetails?.reason ?? "unspecified";

          if (reason === "hijacking") {
            await terminateUserSessions(user.id);
            entry.actions.push("sessions_terminated:account-disabled-hijacking");
          }

          await setGoogleSigninDisabled(user, true, `account_disabled:${reason}`);
          entry.actions.push(`google_signin_disabled:${reason}`);
          continue;
        }

        if (eventType === EVENT_TYPES.accountEnabled) {
          await setGoogleSigninDisabled(user, false, "account_enabled");
          entry.actions.push("google_signin_reenabled");
          continue;
        }

        if (eventType === EVENT_TYPES.tokenRevoked) {
          entry.actions.push("token_revoke_received");
          continue;
        }

        if (eventType === EVENT_TYPES.accountCredentialChangeRequired) {
          entry.actions.push("credential_change_required_received");
          continue;
        }

        if (eventType === EVENT_TYPES.verification) {
          entry.actions.push(
            `verification_received:${typeof eventDetails?.state === "string" ? eventDetails.state : ""}`,
          );
          continue;
        }

        entry.actions.push(`ignored_unhandled_event:${eventType}`);
      } catch (error) {
        entry.errors.push(
          error instanceof Error
            ? `${eventType}:${error.message}`
            : `${eventType}:Unknown error`,
        );
      }
    }

    results.push(entry);
  }

  return {
    jti: payload.jti ?? null,
    subjectsCount: subjects.length,
    results,
  };
}