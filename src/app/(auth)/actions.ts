"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/request";
import { safeNextPath } from "@/lib/security/redirect";
import { oauthProviderSchema } from "@/lib/validation/auth";

/** Sign in with Google Workspace or Microsoft 365 (Supabase Auth, PKCE). */
export async function oauthAction(formData: FormData) {
  const parsed = oauthProviderSchema.safeParse(formData.get("provider"));
  if (!parsed.success) redirect("/auth/error?reason=oauth");
  const provider = parsed.data;
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${await requestOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
      scopes: provider === "azure" ? "email openid profile" : undefined,
    },
  });
  if (error || !data.url) redirect("/auth/error?reason=oauth");
  redirect(data.url);
}
