import type { NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { buildCsp } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
  });
  // Next applies the nonce to its own scripts when it sees the CSP on the request.
  const response = await updateSession(request, {
    "x-nonce": nonce,
    "content-security-policy": csp,
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, images and brand files.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
