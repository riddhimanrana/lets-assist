/**
 * Tests for encryption utilities
 * @see lib/encryption.ts
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt, generateEncryptionKey } from "@/lib/encryption";

describe("Encryption utilities", () => {
  const originalEnv = process.env.ENCRYPTION_KEY;
  
  beforeEach(() => {
    // Set a valid encryption key for tests
    process.env.ENCRYPTION_KEY = "test-encryption-key-must-be-32-chars!";
  });
  
  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalEnv;
  });
  
  describe("encrypt", () => {
    it("encrypts a string and returns formatted output", () => {
      const plaintext = "Hello, World!";
      const encrypted = encrypt(plaintext);
      
      // Should be in format: salt:iv:tag:data (4 parts separated by colons)
      const parts = encrypted.split(":");
      expect(parts).toHaveLength(4);
      
      // Each part should be base64 encoded
      parts.forEach((part) => {
        expect(() => Buffer.from(part, "base64")).not.toThrow();
      });
    });
    
    it("produces different output for same input (random salt/IV)", () => {
      const plaintext = "Same input text";
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);
      
      expect(encrypted1).not.toBe(encrypted2);
    });
    
    it("handles empty strings", () => {
      const encrypted = encrypt("");
      expect(encrypted).toBeTruthy();
      expect(decrypt(encrypted)).toBe("");
    });
    
    it("handles unicode characters", () => {
      const plaintext = "Hello 世界 🌍 مرحبا";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });
    
    it("handles long strings", () => {
      const plaintext = "x".repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });
  });
  
  describe("decrypt", () => {
    it("decrypts previously encrypted data", () => {
      const plaintext = "Secret OAuth token";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
    });
    
    it("throws error for invalid format (not 4 parts)", () => {
      expect(() => decrypt("invalid")).toThrow("Invalid encrypted data format");
      expect(() => decrypt("a:b:c")).toThrow("Invalid encrypted data format");
      expect(() => decrypt("a:b:c:d:e")).toThrow("Invalid encrypted data format");
    });
    
    it("throws error for tampered data", () => {
      const encrypted = encrypt("test");
      const parts = encrypted.split(":");
      
      // Tamper with the encrypted data
      parts[3] = "tampered" + parts[3];
      const tampered = parts.join(":");
      
      expect(() => decrypt(tampered)).toThrow();
    });
    
    it("throws error for invalid base64", () => {
      expect(() => decrypt("!!!:!!!:!!!:!!!")).toThrow();
    });
  });
  
  describe("generateEncryptionKey", () => {
    it("generates a 64-character hex string", () => {
      const key = generateEncryptionKey();
      
      expect(key).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(/^[0-9a-f]+$/.test(key)).toBe(true);
    });
    
    it("generates unique keys", () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      
      expect(key1).not.toBe(key2);
    });
  });
  
  describe("environment validation", () => {
    it("throws error when ENCRYPTION_KEY is not set", () => {
      delete process.env.ENCRYPTION_KEY;
      
      expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY environment variable is not set");
    });
    
    it("throws error when ENCRYPTION_KEY is too short", () => {
      process.env.ENCRYPTION_KEY = "short";
      
      expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY must be at least 32 characters long");
    });
  });
  
  describe("roundtrip scenarios", () => {
    it("handles JSON data", () => {
      const data = { access_token: "abc123", refresh_token: "xyz789", expires_in: 3600 };
      const json = JSON.stringify(data);
      
      const encrypted = encrypt(json);
      const decrypted = decrypt(encrypted);
      
      expect(JSON.parse(decrypted)).toEqual(data);
    });
    
    it("handles special characters", () => {
      const specialChars = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~\n\t\r";
      const encrypted = encrypt(specialChars);
      const decrypted = decrypt(encrypted);
      
      expect(decrypted).toBe(specialChars);
    });
  });
});
