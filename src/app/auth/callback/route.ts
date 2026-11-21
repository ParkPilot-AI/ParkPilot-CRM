import { NextResponse, type NextRequest } from "next/server";
import { publicUrl } from "@/lib/http/origin";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/security/redirect";

/** OAuth (Google / Microsoft sign-in) PKCE code exchange. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(publicUrl(request.headers, next));
  }

  // A code can only be used once. If it was already exchanged (double
  // submission, back button) and the visitor is signed in, carry on.
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) return NextResponse.redirect(publicUrl(request.headers, next));

  return NextResponse.redirect(publicUrl(request.headers, "/auth/error?reason=callback"));
}
