import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

/** Hash an export password for storage; the clear-text password is never persisted. */
export async function hashWorkoutExportPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Verify a password against the versioned, salted scrypt format above. */
export async function verifyWorkoutExportPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltEncoded, keyEncoded] = stored.split("$");
  if (algorithm !== "scrypt" || !saltEncoded || !keyEncoded) return false;
  try {
    const salt = Buffer.from(saltEncoded, "base64url");
    const expected = Buffer.from(keyEncoded, "base64url");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
