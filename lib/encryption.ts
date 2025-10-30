/**
 * Encryption utilities for sensitive data (OAuth tokens)
 * Uses AES-256-GCM encryption
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Get encryption key from environment variable
 */
function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  if (key.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters long');
  }
  return key;
}

/**
 * Derive a key from the encryption key using PBKDF2
 */
function deriveKey(salt: Buffer): Buffer {
  const encryptionKey = getEncryptionKey();
  return crypto.pbkdf2Sync(encryptionKey, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a string
 * Returns: salt:iv:tag:encryptedData (all base64 encoded)
 */
export function encrypt(text: string): string {
  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Derive key from salt
  const key = deriveKey(salt);
  
  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  // Encrypt
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  // Get auth tag
  const tag = cipher.getAuthTag();
  
  // Combine salt, iv, tag, and encrypted data
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted
  ].join(':');
}

/**
 * Decrypt a string encrypted with encrypt()
 */
export function decrypt(encryptedData: string): string {
  try {
    // Split the encrypted data
    const parts = encryptedData.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted data format');
    }
    
    const [saltB64, ivB64, tagB64, encrypted] = parts;
    
    // Convert from base64
    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    
    // Derive key from salt
    const key = deriveKey(salt);
    
    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    // Decrypt
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt data: ' + (error as Error).message);
  }
}

/**
 * Generate a random encryption key (for setup)
 * Use this to generate your ENCRYPTION_KEY environment variable
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
