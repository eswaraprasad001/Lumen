import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { appEnv } from "@/lib/env";

const CURRENT_VERSION = 1;

function getKey() {
  if (!appEnv.encryptionKey) {
    throw new Error("APP_ENCRYPTION_KEY is required for live Gmail token storage.");
  }

  return createHash("sha256").update(appEnv.encryptionKey).digest();
}

/**
 * Encrypts a secret with AES-256-GCM and returns a versioned string.
 * Format: `v<version>:<base64(iv + authTag + ciphertext)>`
 *
 * The `v1:` prefix enables future key rotation: when a new key version is
 * introduced, decrypt with the old key (matched by stored version) and
 * re-encrypt with the new key (new version prefix).
 */
export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, authTag, encrypted]).toString("base64");
  return `v${CURRENT_VERSION}:${payload}`;
}

/**
 * Decrypts a secret produced by `encryptSecret`.
 * Supports both the legacy unversioned base64 format (written before key
 * versioning was introduced) and the current `v1:<base64>` format.
 */
export function decryptSecret(raw: string) {
  let payload: string;

  if (raw.startsWith("v1:")) {
    payload = raw.slice(3);
  } else {
    // Legacy format: plain base64, no version prefix — treat as v1
    payload = raw;
  }

  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
