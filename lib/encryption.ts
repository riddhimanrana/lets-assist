/** AES-256-GCM helpers for OAuth credentials and other server-held secrets. */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;
const FORMAT_VERSION = "v2";
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
const MAX_KEYS = 10;

type EncryptionKeyring = {
  activeKeyId: string;
  keys: Map<string, string>;
  versioned: boolean;
};

export type DecryptionResult = {
  plaintext: string;
  keyId: string;
  needsRotation: boolean;
  reencrypted: string | null;
};

function validateSecret(secret: unknown): string {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Encryption key material must be at least 32 characters");
  }
  return secret;
}

function readEncryptionKeyring(
  environment: {
    ENCRYPTION_KEYRING?: string;
    ENCRYPTION_KEY?: string;
  } = {
    ENCRYPTION_KEYRING: process.env.ENCRYPTION_KEYRING,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  },
): EncryptionKeyring {
  const encoded = environment.ENCRYPTION_KEYRING?.trim();
  const legacy = environment.ENCRYPTION_KEY;

  if (!encoded) {
    return {
      activeKeyId: "legacy",
      keys: new Map([["legacy", validateSecret(legacy)]]),
      versioned: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error("ENCRYPTION_KEYRING is invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ENCRYPTION_KEYRING is invalid");
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
    throw new Error("ENCRYPTION_KEYRING is invalid");
  }

  const entries = Object.entries(configuredKeys as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_KEYS) {
    throw new Error("ENCRYPTION_KEYRING is invalid");
  }
  const keys = new Map<string, string>();
  for (const [keyId, secret] of entries) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new Error("ENCRYPTION_KEYRING is invalid");
    }
    keys.set(keyId, validateSecret(secret));
  }
  if (!keys.has(activeKeyId)) {
    throw new Error("ENCRYPTION_KEYRING active key is missing");
  }
  if (legacy && !Array.from(keys.values()).includes(legacy)) {
    keys.set("legacy", validateSecret(legacy));
  }
  if (keys.size > MAX_KEYS) {
    throw new Error("ENCRYPTION_KEYRING has too many keys");
  }

  return { activeKeyId, keys, versioned: true };
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, "sha256");
}

function encryptWithKey(text: string, secret: string): string[] {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(secret, salt), iv);
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return [
    salt.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted,
  ];
}

/** Encrypt using the active key. A configured keyring records its key ID. */
export function encrypt(text: string): string {
  const keyring = readEncryptionKeyring();
  const secret = keyring.keys.get(keyring.activeKeyId);
  if (!secret) throw new Error("Active encryption key is unavailable");
  const parts = encryptWithKey(text, secret);
  return keyring.versioned
    ? [FORMAT_VERSION, keyring.activeKeyId, ...parts].join(":")
    : parts.join(":");
}

function decryptParts(parts: string[], secret: string): string {
  const [saltB64, ivB64, tagB64, encrypted] = parts;
  if (!saltB64 || !ivB64 || !tagB64 || encrypted === undefined) {
    throw new Error("Invalid encrypted data format");
  }
  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    deriveKey(secret, salt),
    iv,
  );
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Decrypt legacy and key-ID ciphertext. The caller can persist `reencrypted`
 * with an equality guard so reads gradually move stored values to the active key.
 */
export function decryptWithRotation(encryptedData: string): DecryptionResult {
  try {
    const keyring = readEncryptionKeyring();
    const parts = encryptedData.split(":");
    const versioned = parts[0] === FORMAT_VERSION;
    const keyId = versioned ? parts[1] : "legacy";
    const encryptedParts = versioned ? parts.slice(2) : parts;
    if (
      !keyId ||
      !KEY_ID_PATTERN.test(keyId) ||
      encryptedParts.length !== 4
    ) {
      throw new Error("Invalid encrypted data format");
    }
    const secret = keyring.keys.get(keyId);
    if (!secret) throw new Error("Encryption key is unavailable");
    const plaintext = decryptParts(encryptedParts, secret);
    const needsRotation =
      keyring.versioned && (!versioned || keyId !== keyring.activeKeyId);
    return {
      plaintext,
      keyId,
      needsRotation,
      reencrypted: needsRotation ? encrypt(plaintext) : null,
    };
  } catch (error) {
    throw new Error("Failed to decrypt data: " + (error as Error).message);
  }
}

export function decrypt(encryptedData: string): string {
  return decryptWithRotation(encryptedData).plaintext;
}

export function isVersionedCiphertext(value: string): boolean {
  return value.startsWith(`${FORMAT_VERSION}:`);
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
