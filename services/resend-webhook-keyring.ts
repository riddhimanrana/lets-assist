import "server-only";

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
const MAX_WEBHOOK_KEYS = 5;

export type ResendWebhookVerificationKey = {
  id: string;
  secret: string;
};

export class ResendWebhookKeyringConfigurationError extends Error {
  constructor() {
    super("Resend webhook keyring configuration is invalid");
    this.name = "ResendWebhookKeyringConfigurationError";
  }
}

function configurationError(): never {
  throw new ResendWebhookKeyringConfigurationError();
}

/**
 * Read the versioned webhook keys. A configured but malformed keyring fails
 * closed. The single legacy secret remains a migration fallback.
 */
export function readResendWebhookVerificationKeys(
  environment: {
    RESEND_WEBHOOK_SECRET_KEYRING?: string;
    RESEND_WEBHOOK_SECRET?: string;
  } = {
    RESEND_WEBHOOK_SECRET_KEYRING: process.env.RESEND_WEBHOOK_SECRET_KEYRING,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  },
): ResendWebhookVerificationKey[] {
  const encoded = environment.RESEND_WEBHOOK_SECRET_KEYRING?.trim();
  const legacy = environment.RESEND_WEBHOOK_SECRET?.trim();
  const keys: ResendWebhookVerificationKey[] = [];

  if (encoded) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded);
    } catch {
      configurationError();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      configurationError();
    }
    const record = parsed as Record<string, unknown>;
    const activeKeyId = record.activeKeyId;
    const configuredKeys = record.keys;
    if (
      typeof activeKeyId !== "string" ||
      !KEY_ID_PATTERN.test(activeKeyId) ||
      !configuredKeys ||
      typeof configuredKeys !== "object" ||
      Array.isArray(configuredKeys)
    ) {
      configurationError();
    }

    const entries = Object.entries(configuredKeys as Record<string, unknown>);
    if (entries.length === 0 || entries.length > MAX_WEBHOOK_KEYS) {
      configurationError();
    }
    const normalized = entries.map(([id, secret]) => {
      if (
        !KEY_ID_PATTERN.test(id) ||
        typeof secret !== "string" ||
        secret.trim().length < 16
      ) {
        configurationError();
      }
      return { id, secret: secret.trim() };
    });
    const active = normalized.find((key) => key.id === activeKeyId);
    if (!active) configurationError();
    keys.push(active, ...normalized.filter((key) => key.id !== activeKeyId));
  }

  if (legacy && !keys.some((key) => key.secret === legacy)) {
    keys.push({ id: "legacy", secret: legacy });
  }

  if (keys.length > MAX_WEBHOOK_KEYS) configurationError();
  return keys;
}
