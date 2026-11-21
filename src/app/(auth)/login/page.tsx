import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME, CONTACT_EMAIL } from "@/config/app";
import { getSessionUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/security/redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  if (await getSessionUser()) redirect(next);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Sign in</CardTitle>
        <CardDescription>
          Use your work Google Workspace or Microsoft 365 account to open {APP_NAME}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OAuthButtons next={next} />
        <p className="mt-6 text-sm text-muted-foreground">
          New to the team? Ask your sales manager for an invitation, then sign in with the same
          email address. Need help? Email{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-accent-text hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
