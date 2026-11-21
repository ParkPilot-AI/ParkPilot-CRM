import { oauthAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z"
      />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10z" />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

export function OAuthButtons({ next }: { next?: string }) {
  return (
    <div className="grid gap-3">
      <form action={oauthAction}>
        <input type="hidden" name="provider" value="google" />
        <input type="hidden" name="next" value={next ?? ""} />
        <Button type="submit" variant="outline" size="lg" className="w-full">
          <GoogleIcon /> Continue with Google
        </Button>
      </form>
      <form action={oauthAction}>
        <input type="hidden" name="provider" value="azure" />
        <input type="hidden" name="next" value={next ?? ""} />
        <Button type="submit" variant="outline" size="lg" className="w-full">
          <MicrosoftIcon /> Continue with Microsoft
        </Button>
      </form>
    </div>
  );
}
