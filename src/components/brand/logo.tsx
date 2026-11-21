import Image from "next/image";
import { APP_NAME } from "@/config/app";
import { cn } from "@/lib/utils";

// Proportions of the generated SVGs (scripts/brand/build.py).
const LOGO_RATIO = 5.3315;
const MARK_RATIO = 81.73 / 56;

/** Full logo (mark + wordmark). Swaps to the dark-background version in dark mode. */
export function Logo({ className, height = 32 }: { className?: string; height?: number }) {
  const width = Math.round(height * LOGO_RATIO);
  return (
    <span className={cn("inline-flex", className)}>
      <Image
        src="/brand/logo.svg"
        alt={APP_NAME}
        width={width}
        height={height}
        className="dark:hidden"
        loading="eager"
        unoptimized
      />
      <Image
        src="/brand/logo-dark.svg"
        alt={APP_NAME}
        width={width}
        height={height}
        className="hidden dark:block"
        loading="eager"
        unoptimized
      />
    </span>
  );
}

export function LogoMark({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex", className)}>
      <Image
        src="/brand/logo-mark.svg"
        alt=""
        width={Math.round(size * MARK_RATIO)}
        height={size}
        className="dark:hidden"
        unoptimized
      />
      <Image
        src="/brand/logo-mark-dark.svg"
        alt=""
        width={Math.round(size * MARK_RATIO)}
        height={size}
        className="hidden dark:block"
        unoptimized
      />
    </span>
  );
}
