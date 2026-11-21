/** Visitor IP as reported by Netlify (falls back to the first X-Forwarded-For hop). */
export function clientIp(headers: Headers): string | null {
  const ip =
    headers.get("x-nf-client-connection-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip");
  if (!ip) return null;
  // Only return something Postgres will accept as inet.
  return /^[0-9a-f:.]+$/i.test(ip) && ip.length <= 45 ? ip : null;
}
