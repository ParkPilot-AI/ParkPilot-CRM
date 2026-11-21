"use client";

import { Button } from "@/components/ui/button";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center"
    >
      <h2 className="font-display text-xl font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        Please try again. If it keeps happening, ask your sales manager.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
