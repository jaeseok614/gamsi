import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "gamsi_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const PASSWORD_SCHEME = "scrypt";
const LEGACY_SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export function authSecret() {
  return process.env.AUTH_SECRET ?? "local-dev-secret-change-before-production";
}

function createLegacyPasswordHash(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

function scryptParams() {
  return {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  };
}

function encodePasswordHash(salt: Buffer, derivedKey: Buffer) {
  return [
    PASSWORD_SCHEME,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("hex"),
    derivedKey.toString("hex")
  ].join("$");
}

function parsePasswordHash(value: string) {
  const [scheme, n, r, p, saltHex, hashHex] = value.split("$");
  if (
    scheme !== PASSWORD_SCHEME ||
    !n ||
    !r ||
    !p ||
    !saltHex ||
    !hashHex ||
    !/^\d+$/.test(n) ||
    !/^\d+$/.test(r) ||
    !/^\d+$/.test(p) ||
    !/^[a-f0-9]+$/i.test(saltHex) ||
    !/^[a-f0-9]+$/i.test(hashHex)
  ) {
    return null;
  }

  return {
    n: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(saltHex, "hex"),
    hash: Buffer.from(hashHex, "hex")
  };
}

function derivePasswordKeySync(password: string, salt: Buffer) {
  return Buffer.from(scryptSync(password, salt, PASSWORD_KEY_LENGTH, scryptParams()));
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derivedKey = derivePasswordKeySync(password, salt);
  return encodePasswordHash(salt, derivedKey);
}

export function hashPasswordSync(password: string) {
  const salt = randomBytes(16);
  const derivedKey = derivePasswordKeySync(password, salt);
  return encodePasswordHash(salt, derivedKey);
}

export function verifyPassword(password: string, passwordHash: string) {
  if (LEGACY_SHA256_PATTERN.test(passwordHash)) {
    const actual = Buffer.from(createLegacyPasswordHash(password), "hex");
    const expected = Buffer.from(passwordHash, "hex");
    if (actual.length !== expected.length) {
      return {
        valid: false,
        needsRehash: false
      };
    }

    const valid = timingSafeEqual(actual, expected);
    return {
      valid,
      needsRehash: valid
    };
  }

  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) {
    return {
      valid: false,
      needsRehash: false
    };
  }

  const actual = Buffer.from(scryptSync(password, parsed.salt, PASSWORD_KEY_LENGTH, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p
  }));
  if (actual.length !== parsed.hash.length) {
    return {
      valid: false,
      needsRehash: false
    };
  }

  return {
    valid: timingSafeEqual(actual, parsed.hash),
    needsRehash: false
  };
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHmac("sha256", authSecret()).update(token).digest("hex");
}

export function verifySessionToken(token?: string | null) {
  if (!token || token.length < 32) {
    return null;
  }

  return token;
}
