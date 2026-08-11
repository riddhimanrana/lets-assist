import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const GOOGLE_OAUTH_STATE_COOKIE_NAME = "lets_assist_google_oauth_state";
export const GOOGLE_OAUTH_STATE_TTL_SECONDS = 5 * 60;

export const GOOGLE_OAUTH_CONNECTION_PURPOSES = [
  "personal_calendar",
  "personal_sheets",
  "organization_calendar",
  "organization_sheets",
  "csf_import",
] as const;

export type GoogleOAuthConnectionPurpose =
  (typeof GOOGLE_OAUTH_CONNECTION_PURPOSES)[number];

export const GOOGLE_OAUTH_CSF_IMPORT_CAPABILITIES = [
  "import_applications",
  "import_members",
  "import_meetings",
  "import_partner_clubs",
] as const;

export type GoogleOAuthCsfImportCapability =
  (typeof GOOGLE_OAUTH_CSF_IMPORT_CAPABILITIES)[number];

const GOOGLE_OAUTH_STATE_VERSION = 2;
const SAFE_REDIRECT_ORIGIN = "https://lets-assist.invalid";
const MINIMUM_STATE_SECRET_LENGTH = 32;
const GOOGLE_OAUTH_STATE_IV_BYTES = 12;
const GOOGLE_OAUTH_STATE_TAG_BYTES = 16;

export type GoogleOAuthStatePayload = {
  version: typeof GOOGLE_OAUTH_STATE_VERSION;
  userId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  returnTo: string | null;
  organizationId: string | null;
  pluginKey: "dvhs-csf" | null;
  purpose: GoogleOAuthConnectionPurpose;
  requestedCapability: GoogleOAuthCsfImportCapability | null;
  isCalendarSync: boolean;
  isSheetsSync: boolean;
};

type CreateGoogleOAuthStateInput = {
  userId: string;
  returnTo?: string | null;
  organizationId?: string | null;
  pluginKey?: "dvhs-csf" | null;
  purpose: GoogleOAuthConnectionPurpose;
  requestedCapability?: GoogleOAuthCsfImportCapability | null;
};

type VerifyGoogleOAuthStateInput = {
  state: string | null | undefined;
  cookieNonce: string | null | undefined;
  currentUserId: string | null | undefined;
  now?: number;
  secret?: string;
};

type GoogleOAuthStateVerification =
  | { ok: true; payload: GoogleOAuthStatePayload }
  | {
      ok: false;
      reason:
        | "missing_state"
        | "missing_cookie"
        | "missing_user"
        | "invalid_state"
        | "expired_state"
        | "nonce_mismatch"
        | "user_mismatch";
    };

function getGoogleOAuthStateSecret(): string {
  const secret =
    process.env.GOOGLE_OAUTH_STATE_SECRET ?? process.env.ENCRYPTION_KEY;

  if (!secret || secret.length < MINIMUM_STATE_SECRET_LENGTH) {
    throw new Error(
      "GOOGLE_OAUTH_STATE_SECRET or ENCRYPTION_KEY must be at least 32 characters long",
    );
  }

  return secret;
}

function deriveStateEncryptionKey(secret: string) {
  // The configured value is a high-entropy signing secret, not a user
  // password. Derive a fixed-length, domain-separated key so the same secret
  // cannot be reused directly by another protocol.
  return scryptSync(
    secret,
    `lets-assist:google-oauth-state:v${GOOGLE_OAUTH_STATE_VERSION}`,
    32,
  );
}

function stateAdditionalData() {
  return Buffer.from(
    `lets-assist:google-oauth-state:v${GOOGLE_OAUTH_STATE_VERSION}`,
  );
}

function encryptStatePayload(payload: GoogleOAuthStatePayload, secret: string) {
  const iv = randomBytes(GOOGLE_OAUTH_STATE_IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveStateEncryptionKey(secret),
    iv,
  );
  cipher.setAAD(stateAdditionalData());
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
}

function decryptStatePayload(state: string, secret: string): unknown {
  const parts = state.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid Google OAuth state envelope");
  }

  const [encodedIv, encodedCiphertext, encodedTag] = parts;
  const iv = Buffer.from(encodedIv, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  const tag = Buffer.from(encodedTag, "base64url");
  if (
    iv.length !== GOOGLE_OAUTH_STATE_IV_BYTES ||
    tag.length !== GOOGLE_OAUTH_STATE_TAG_BYTES ||
    ciphertext.length === 0
  ) {
    throw new Error("Invalid Google OAuth state envelope");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveStateEncryptionKey(secret),
    iv,
  );
  decipher.setAAD(stateAdditionalData());
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as unknown;
}

function safelyEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function isGoogleOAuthConnectionPurpose(
  value: string | null | undefined,
): value is GoogleOAuthConnectionPurpose {
  return GOOGLE_OAUTH_CONNECTION_PURPOSES.some((purpose) => purpose === value);
}

export function isGoogleOAuthCsfImportCapability(
  value: string | null | undefined,
): value is GoogleOAuthCsfImportCapability {
  return GOOGLE_OAUTH_CSF_IMPORT_CAPABILITIES.some(
    (capability) => capability === value,
  );
}

function isValidGoogleOAuthIntent(
  value: Pick<
    GoogleOAuthStatePayload,
    "organizationId" | "pluginKey" | "purpose" | "requestedCapability"
  >,
): boolean {
  if (value.purpose === "csf_import") {
    return Boolean(
      value.organizationId &&
      value.pluginKey === "dvhs-csf" &&
      isGoogleOAuthCsfImportCapability(value.requestedCapability),
    );
  }

  if (value.pluginKey !== null || value.requestedCapability !== null) {
    return false;
  }

  if (
    value.purpose === "organization_calendar" ||
    value.purpose === "organization_sheets"
  ) {
    return Boolean(value.organizationId);
  }

  return value.organizationId === null;
}

export function normalizeGoogleOAuthReturnTo(
  returnTo: string | null | undefined,
): string | null {
  if (
    !returnTo ||
    returnTo.trim() !== returnTo ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\") ||
    hasControlCharacter(returnTo)
  ) {
    return null;
  }

  try {
    const parsed = new URL(returnTo, SAFE_REDIRECT_ORIGIN);
    if (parsed.origin !== SAFE_REDIRECT_ORIGIN) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function isGoogleOAuthStatePayload(
  value: unknown,
): value is GoogleOAuthStatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<GoogleOAuthStatePayload>;
  return (
    payload.version === GOOGLE_OAUTH_STATE_VERSION &&
    typeof payload.userId === "string" &&
    payload.userId.length > 0 &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 32 &&
    typeof payload.issuedAt === "number" &&
    Number.isSafeInteger(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isSafeInteger(payload.expiresAt) &&
    (payload.returnTo === null || typeof payload.returnTo === "string") &&
    (payload.organizationId === null ||
      (typeof payload.organizationId === "string" &&
        payload.organizationId.trim() === payload.organizationId &&
        payload.organizationId.length > 0)) &&
    (payload.pluginKey === null || payload.pluginKey === "dvhs-csf") &&
    isGoogleOAuthConnectionPurpose(payload.purpose) &&
    (payload.requestedCapability === null ||
      isGoogleOAuthCsfImportCapability(payload.requestedCapability)) &&
    isValidGoogleOAuthIntent({
      organizationId: payload.organizationId ?? null,
      pluginKey: payload.pluginKey ?? null,
      purpose: payload.purpose as GoogleOAuthConnectionPurpose,
      requestedCapability: payload.requestedCapability ?? null,
    }) &&
    payload.isCalendarSync === (payload.purpose === "organization_calendar") &&
    payload.isSheetsSync === (payload.purpose === "organization_sheets")
  );
}

export function createGoogleOAuthState(
  input: CreateGoogleOAuthStateInput,
  options: { now?: number; secret?: string; nonce?: string } = {},
): { state: string; nonce: string; payload: GoogleOAuthStatePayload } {
  const now = options.now ?? Date.now();
  const nonce = options.nonce ?? randomBytes(32).toString("base64url");
  const secret = options.secret ?? getGoogleOAuthStateSecret();

  const intent = {
    organizationId: input.organizationId?.trim() || null,
    pluginKey: input.pluginKey ?? null,
    purpose: input.purpose,
    requestedCapability: input.requestedCapability ?? null,
  };
  if (!isValidGoogleOAuthIntent(intent)) {
    throw new Error("Invalid Google OAuth connection purpose");
  }

  const payload: GoogleOAuthStatePayload = {
    version: GOOGLE_OAUTH_STATE_VERSION,
    userId: input.userId,
    nonce,
    issuedAt: now,
    expiresAt: now + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000,
    returnTo: normalizeGoogleOAuthReturnTo(input.returnTo),
    ...intent,
    isCalendarSync: input.purpose === "organization_calendar",
    isSheetsSync: input.purpose === "organization_sheets",
  };

  return {
    state: encryptStatePayload(payload, secret),
    nonce,
    payload,
  };
}

export function verifyGoogleOAuthState(
  input: VerifyGoogleOAuthStateInput,
): GoogleOAuthStateVerification {
  if (!input.state) {
    return { ok: false, reason: "missing_state" };
  }

  if (!input.cookieNonce) {
    return { ok: false, reason: "missing_cookie" };
  }

  if (!input.currentUserId) {
    return { ok: false, reason: "missing_user" };
  }

  try {
    const secret = input.secret ?? getGoogleOAuthStateSecret();
    const parsedPayload = decryptStatePayload(input.state, secret);

    if (!isGoogleOAuthStatePayload(parsedPayload)) {
      return { ok: false, reason: "invalid_state" };
    }

    const now = input.now ?? Date.now();
    if (
      parsedPayload.issuedAt > now + 30_000 ||
      parsedPayload.expiresAt <= now ||
      parsedPayload.expiresAt - parsedPayload.issuedAt !==
        GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000
    ) {
      return { ok: false, reason: "expired_state" };
    }

    if (!safelyEqual(parsedPayload.nonce, input.cookieNonce)) {
      return { ok: false, reason: "nonce_mismatch" };
    }

    if (!safelyEqual(parsedPayload.userId, input.currentUserId)) {
      return { ok: false, reason: "user_mismatch" };
    }

    if (
      parsedPayload.returnTo !==
      normalizeGoogleOAuthReturnTo(parsedPayload.returnTo)
    ) {
      return { ok: false, reason: "invalid_state" };
    }

    return { ok: true, payload: parsedPayload };
  } catch {
    return { ok: false, reason: "invalid_state" };
  }
}

export function getGoogleOAuthStateCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/calendar/google/callback",
    maxAge: GOOGLE_OAUTH_STATE_TTL_SECONDS,
  };
}
