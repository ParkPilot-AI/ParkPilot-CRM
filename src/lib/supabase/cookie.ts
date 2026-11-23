/**
 * One sign-in across the ParkPilot platform: the hub (ai.parkpilot.uk), ParkPilot CRM
 * (crm.parkpilot.uk) and ParkPilot ecco (ecco.parkpilot.uk) share one Supabase project and this
 * cookie. Keep this file identical in every app.
 *
 * On any *.parkpilot.uk address the cookie is set for the whole domain, so signing in once covers
 * every app. Elsewhere (deploy previews on *.netlify.app, localhost) it stays on that host.
 */
export const AUTH_COOKIE_NAME = "sb-parkpilot-auth";
const PLATFORM_DOMAIN = "parkpilot.uk";

export function authCookieOptions(host?: string | null): { name: string; domain?: string } {
  const h = (host ?? (typeof window !== "undefined" ? window.location.hostname : ""))
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  const shared = h === PLATFORM_DOMAIN || h.endsWith(`.${PLATFORM_DOMAIN}`);
  return shared
    ? { name: AUTH_COOKIE_NAME, domain: `.${PLATFORM_DOMAIN}` }
    : { name: AUTH_COOKIE_NAME };
}
