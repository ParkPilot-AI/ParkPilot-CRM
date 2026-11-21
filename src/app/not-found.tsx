import Link from "next/link";
import { StrokeField } from "@/components/brand/stroke-field";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <StrokeField />
      <h1 className="font-display text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground">That page doesn&apos;t exist or has moved.</p>
      <Button asChild>
        <Link href="/today">Go to Today</Link>
      </Button>
    </main>
  );
}
