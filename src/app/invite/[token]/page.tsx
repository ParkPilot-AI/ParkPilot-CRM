import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WORKSPACE_COOKIE } from "@/config/app";
import { logAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { workspaceCookieOptions } from "@/lib/workspace/cookie";

export const metadata: Metadata = { title: "Join your team" };

// Fixed messages only: never echo text from the URL (it could be used to show fake notices).
const ERRORS: Record<string, string> = {
  mismatch:
    "This invitation was sent to a different email address. Sign in with that address, or ask for a new invitation.",
  invalid:
    "This invitation is invalid, has expired or has already been used. Ask a workspace admin for a new one.",
};

async function acceptInvite(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error || !data)
    redirect(
      `/invite/${encodeURIComponent(token)}?error=${/email|address/i.test(error?.message ?? "") ? "mismatch" : "invalid"}`,
    );
  await logAudit({
    workspaceId: data,
    actorId: user.id,
    action: "member.joined",
    targetType: "user",
    targetId: user.id,
  });
  (await cookies()).set(WORKSPACE_COOKIE, data, workspaceCookieOptions());
  redirect("/today");
}

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;
  const user = await getSessionUser();
  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-muted p-6"
    >
      <Logo height={34} />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-2xl">You&apos;ve been invited</CardTitle>
          <CardDescription>
            Accept to join your park&apos;s sales team. Sign in with the Google or Microsoft account
            for the email address the invitation was sent to.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {typeof error === "string" ? (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {ERRORS[error] ?? ERRORS.invalid}
            </p>
          ) : null}
          {user ? (
            <form action={acceptInvite} className="grid gap-3">
              <input type="hidden" name="token" value={token} />
              <p className="text-sm text-muted-foreground">
                Signed in as <strong className="text-foreground">{user.email}</strong>
              </p>
              <Button type="submit">Accept invitation</Button>
            </form>
          ) : (
            <Button asChild>
              <Link href={`/login?next=${next}`}>Sign in with Google or Microsoft</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
