import { publicEnv } from "@/lib/env";

/**
 * The public origin the visitor is actually using.
 *
 * On Netlify, `request.url` / `request.nextUrl.origin` inside a function is the
 * internal per-deploy address (`<deploy-id>--<site>.netlify.app`), not the
 * domain in the browser. Redirecting there moves the user to a different host
 * where their session cookie doesn't exist. Use the forwarded host instead,
 * but only if it's one of ours, so a forged header can't redirect elsewhere.
 */
export function resolvePublicOrigin(
  headers: Headers,
  siteUrl: string = publicEnv.NEXT_PUBLIC_SITE_URL,
): string {
  const site = new URL(siteUrl);
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = (forwarded || headers.get("host") || "").toLowerCase();
  if (!host || !isAllowedHost(host, site.host)) return site.origin;
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || (isLocal ? "http" : "https");
  return `${proto === "http" && !isLocal ? "https" : proto}://${host}`;
}

/**
 * Hosts we'll redirect to: the canonical site (e.g. crm.parkpilot.uk), localhost,
 * and this Netlify site's own addresses (<site>.netlify.app plus deploy previews,
 * branch deploys and permalinks: <prefix>--<site>.netlify.app). The Netlify site
 * name comes from the canonical host when it's a netlify.app address, otherwise
 * from Netlify's SITE_NAME runtime variable.
 */
export function isAllowedHost(
  host: string,
  siteHost: string,
  netlifySiteName: string | undefined = process.env.SITE_NAME,
): boolean {
  const h = host.toLowerCase();
  const s = siteHost.toLowerCase();
  if (h === s) return true;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)) return true;
  const netlifyHost = s.endsWith(".netlify.app")
    ? s
    : netlifySiteName && /^[a-z0-9-]+$/i.test(netlifySiteName)
      ? `${netlifySiteName.toLowerCase()}.netlify.app`
      : null;
  if (!netlifyHost) return false;
  if (h === netlifyHost) return true;
  const prefix = h.slice(0, -`--${netlifyHost}`.length);
  return h.endsWith(`--${netlifyHost}`) && /^[a-z0-9-]+$/.test(prefix) && !prefix.includes("--");
}

/** Absolute URL on the public origin for a same-site path. */
export function publicUrl(headers: Headers, path: string): URL {
  return new URL(path, resolvePublicOrigin(headers));
}
