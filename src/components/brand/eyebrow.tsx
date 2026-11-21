import { cn } from "@/lib/utils";

/** Brand eyebrow: a 32×2 red rule, then a short uppercase label (13 / 600, wide tracking). */
export function Eyebrow({
  children,
  className,
  onDark = false,
}: {
  children: React.ReactNode;
  className?: string;
  onDark?: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.14em]",
        onDark ? "text-white/80" : "text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("h-0.5 w-8 shrink-0", onDark ? "bg-accent-light" : "bg-accent")}
      />
      {children}
    </p>
  );
}
