/**
 * Only allow same-site relative redirects ("/today?x=1"), never
 * protocol-relative ("//evil.com") or absolute URLs.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/today"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}
