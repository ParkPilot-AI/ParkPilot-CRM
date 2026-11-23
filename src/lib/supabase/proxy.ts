import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { authCookieOptions } from "@/lib/supabase/cookie";

const PUBLIC_PREFIXES = ["/api/v1", "/login", "/auth", "/invite"];

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}

/**
 * Refreshes the Supabase session cookie on every request and performs an
 * optimistic redirect to /login for protected pages. Real authorisation
 * happens in the data layer (getClaims + RLS).
 */
export async function updateSession(
  request: NextRequest,
  extraHeaders: Record<string, string> = {},
) {
  // Forward extra request headers (e.g. the CSP nonce). Rebuilt from the live request each
  // time so refreshed auth cookies (set via request.cookies above) are never lost.
  const next = () => {
    const headers = new Headers(request.headers);
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
    return NextResponse.next({ request: { headers } });
  };
  let response = next();

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: authCookieOptions(
        request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
      ),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = next();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not put code between createServerClient and getClaims().
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  // An auth code on a normal page (e.g. Supabase fell back to the Site URL).
  // Signed in already → just drop the spent code from the address.
  // Signed out → let the callback exchange it. Never re-submit a code twice.
  const { pathname, searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  if (code && !pathname.startsWith("/auth/") && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("code");
    if (signedIn) {
      url.searchParams.delete("next");
      return withCookies(NextResponse.redirect(url), response);
    }
    url.pathname = "/auth/callback";
    url.search = "";
    url.searchParams.set("code", code);
    url.searchParams.set(
      "next",
      searchParams.get("next") ?? (pathname === "/" ? "/today" : pathname),
    );
    return NextResponse.redirect(url);
  }

  if (!signedIn && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return response;
}

/** Carry refreshed session cookies over to a redirect response. */
function withCookies(target: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach((c) => target.cookies.set(c));
  return target;
}
