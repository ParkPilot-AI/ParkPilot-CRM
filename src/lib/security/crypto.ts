import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * AES-256-GCM envelope: "v<keyVersion>.<iv>.<authTag>.<ciphertext>" (base64url parts).
 * Used for OAuth refresh/access tokens at rest.
 */
export function encryptSecret(plaintext: string, keyB64: string, keyVersion = 1): string {
  const key = decodeKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${keyVersion}`,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt with the first key that authenticates (GCM rejects wrong keys), so
 * envelopes written before a key rotation still open. `keyIndex` > 0 means an
 * old key was needed and the value should be re-encrypted with keys[0].
 */
export function decryptWithKeys(
  envelope: string,
  keys: readonly string[],
): { plaintext: string; keyIndex: number } {
  let lastError: unknown = new Error("No decryption keys configured");
  for (const [keyIndex, key] of keys.entries()) {
    try {
      return { plaintext: decryptSecret(envelope, key), keyIndex };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export function decryptSecret(envelope: string, keyB64: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0])) throw new Error("Malformed ciphertext");
  const [, ivB, tagB, ctB] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeKey(keyB64),
    Buffer.from(ivB, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}

function decodeKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes (base64)");
  return key;
}

/** URL-safe random token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Signed, non-guessable tokens for public links (unsubscribe, tracking):
 * "<base64url(json payload)>.<base64url(hmac)>". Optional expiry (`exp`, unix seconds).
 */
export function signPayload<T extends object>(payload: T, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verify against the current secret or any previous one (rotation), so links
 * already in people's inboxes keep working after LINK_SIGNING_SECRET changes.
 */
export function verifyPayload<T extends object>(
  token: string,
  secret: string | readonly string[],
): T | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.length > 8192) return null;
  const body = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), "base64url");
  const secrets = typeof secret === "string" ? [secret] : secret;
  const ok = secrets.some((s) => {
    const expected = createHmac("sha256", s).update(body).digest();
    return sig.length === expected.length && timingSafeEqual(sig, expected);
  });
  if (!ok) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & {
      exp?: number;
    };
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
