import { afterAll, beforeEach, describe, expect, test } from "bun:test";

const original = {
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  ENCRYPTION_KEYRING: process.env.ENCRYPTION_KEYRING,
};

function restore() {
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const encryption = await import("./encryption");

beforeEach(restore);
afterAll(restore);

describe("versioned encryption keyring", () => {
  test("keeps the legacy four-part format when no keyring is configured", () => {
    delete process.env.ENCRYPTION_KEYRING;
    process.env.ENCRYPTION_KEY = "l".repeat(32);
    const ciphertext = encryption.encrypt("synthetic credential");

    expect(ciphertext.split(":")).toHaveLength(4);
    expect(encryption.decrypt(ciphertext)).toBe("synthetic credential");
  });

  test("writes the active key ID and reads it", () => {
    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "current",
      keys: { current: "c".repeat(32), retained: "r".repeat(32) },
    });
    delete process.env.ENCRYPTION_KEY;

    const ciphertext = encryption.encrypt("synthetic credential");

    expect(ciphertext.startsWith("v2:current:")).toBe(true);
    expect(encryption.decryptWithRotation(ciphertext)).toMatchObject({
      plaintext: "synthetic credential",
      keyId: "current",
      needsRotation: false,
      reencrypted: null,
    });
  });

  test("reads legacy ciphertext and produces active-key replacement", () => {
    delete process.env.ENCRYPTION_KEYRING;
    process.env.ENCRYPTION_KEY = "l".repeat(32);
    const legacy = encryption.encrypt("synthetic credential");

    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "current",
      keys: { current: "c".repeat(32) },
    });
    const rotated = encryption.decryptWithRotation(legacy);

    expect(rotated).toMatchObject({
      plaintext: "synthetic credential",
      keyId: "legacy",
      needsRotation: true,
    });
    expect(rotated.reencrypted?.startsWith("v2:current:")).toBe(true);
    expect(encryption.decrypt(rotated.reencrypted ?? "")).toBe(
      "synthetic credential",
    );
  });

  test("keeps the legacy alias when the active key uses the same material", () => {
    delete process.env.ENCRYPTION_KEYRING;
    process.env.ENCRYPTION_KEY = "s".repeat(32);
    const legacy = encryption.encrypt("synthetic credential");

    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "current",
      keys: { current: "s".repeat(32) },
    });

    expect(encryption.decryptWithRotation(legacy)).toMatchObject({
      plaintext: "synthetic credential",
      keyId: "legacy",
      needsRotation: true,
    });
  });

  test("rotates a retained key and fails closed without it", () => {
    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "retained",
      keys: { retained: "r".repeat(32) },
    });
    const retained = encryption.encrypt("synthetic credential");

    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "current",
      keys: { current: "c".repeat(32), retained: "r".repeat(32) },
    });
    const rotated = encryption.decryptWithRotation(retained);
    expect(rotated.needsRotation).toBe(true);

    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "current",
      keys: { current: "c".repeat(32) },
    });
    expect(() => encryption.decrypt(retained)).toThrow(
      "Encryption key is unavailable",
    );
  });

  test("rejects malformed keyrings instead of falling back", () => {
    process.env.ENCRYPTION_KEY = "l".repeat(32);
    process.env.ENCRYPTION_KEYRING = '{"activeKeyId":"missing","keys":{}}';
    expect(() => encryption.encrypt("synthetic credential")).toThrow(
      "ENCRYPTION_KEYRING is invalid",
    );
  });

  test("reserves the legacy key ID for the fallback secret", () => {
    process.env.ENCRYPTION_KEY = "l".repeat(32);
    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "legacy",
      keys: { legacy: "c".repeat(32) },
    });

    expect(() => encryption.encrypt("synthetic credential")).toThrow(
      "ENCRYPTION_KEYRING is invalid",
    );
  });

  test("creates retained-key digests without exposing key material", () => {
    process.env.ENCRYPTION_KEYRING = JSON.stringify({
      activeKeyId: "current",
      keys: { current: "c".repeat(32), retained: "r".repeat(32) },
    });
    delete process.env.ENCRYPTION_KEY;

    const active = encryption.createEncryptionKeyedDigest(
      "synthetic/domain",
      "value",
    );
    const retained = encryption.createEncryptionKeyedDigest(
      "synthetic/domain",
      "value",
      "retained",
    );

    expect(active.keyId).toBe("current");
    expect(active.digest).toHaveLength(43);
    expect(retained.keyId).toBe("retained");
    expect(retained.digest).toHaveLength(43);
    expect(retained.digest).not.toBe(active.digest);
  });
});
