import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of an "Authorization: Bearer <secret>" header against the configured
 * secrets. Both sides are hashed first so differing lengths don't leak through timing.
 */
export function bearerMatches(header: string | null, secrets: readonly string[]): boolean {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!m) return false;
  const given = createHash("sha256").update(m[1]).digest();
  let ok = false;
  for (const s of secrets) {
    const expected = createHash("sha256").update(s).digest();
    if (timingSafeEqual(given, expected)) ok = true;
  }
  return ok;
}
