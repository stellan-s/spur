import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { ConfigurationError } from "./errors";

function encryptionKey(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new ConfigurationError("SPUR_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new ConfigurationError("SPUR_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function encryptOrganizationSecret(organisation: string, name: string, value: string, key: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(["v1", organisation, name])));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptOrganizationSecret(organisation: string, name: string, value: string, key: string | undefined): string {
  const bytes = encryptionKey(key);
  try {
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", bytes, Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(JSON.stringify(["v1", organisation, name])));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new ConfigurationError("An organisation credential could not be decrypted. Check the encryption key.");
  }
}
