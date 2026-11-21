import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const MESSAGES: Record<string, string> = {
  link: "That link is invalid or has expired. Links can only be used once.",
  callback: "We couldn't complete sign-in with that provider. Please try again.",
  oauth: "We couldn't start sign-in with that provider. It may not be configured yet.",
};

export default async function AuthErrorPage({ searchParams }: PageProps<"/auth/error">) {
  const { reason } = await searchParams;
  const message =
    MESSAGES[typeof reason === "string" ? reason : ""] ?? "Something went wrong signing you in.";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <Logo height={32} />
      <h1 className="font-display text-2xl font-semibold">Sign-in problem</h1>
      <p className="max-w-md text-muted-foreground">{message}</p>
      <Button asChild>
        <Link href="/login">Back to sign in</Link>
      </Button>
    </main>
  );
}
