import { cn } from "@/lib/utils";

/**
 * Loading indicator built from the ParkPilot mark: the two strokes hold still
 * while the red dot pulses. Respects prefers-reduced-motion (globals.css).
 */
export function RippleLoader({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn("inline-flex h-8 items-center text-foreground", className)}
    >
      <svg viewBox="0 0 366 251" className="h-full w-auto max-w-full" aria-hidden>
        <g
          stroke="currentColor"
          strokeWidth="70"
          strokeLinecap="round"
          transform="translate(-3.2 -1.7)"
        >
          <line x1="38.2" y1="217" x2="184.5" y2="36.7" />
          <line x1="184.5" y1="217" x2="264.8" y2="118" />
        </g>
        <circle
          cx="327.7"
          cy="35.4"
          r="37.6"
          fill="var(--accent)"
          className="origin-[327.7px_35.4px] animate-dot"
        />
      </svg>
    </span>
  );
}
