import { cn } from "@/lib/utils";

/**
 * Brand "stroke field" (Brand Foundation · 03): tone-on-tone round-capped
 * strokes at the mark's angle, with one red dot. Decorative only.
 */
const STROKES: [number, number, number][] = [
  // x, y (start, bottom-left), length
  [20, 150, 120],
  [70, 165, 70],
  [118, 158, 150],
  [190, 172, 90],
  [238, 150, 130],
];

export function StrokeField({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark";
}) {
  const stroke = tone === "dark" ? "rgba(255,255,255,0.08)" : "var(--border)";
  const a = (51 * Math.PI) / 180;
  return (
    <svg viewBox="0 0 360 200" className={cn("h-24 w-44", className)} aria-hidden fill="none">
      <g stroke={stroke} strokeWidth={22} strokeLinecap="round">
        {STROKES.map(([x, y, len], i) => (
          <line key={i} x1={x} y1={y} x2={x + Math.cos(a) * len} y2={y - Math.sin(a) * len} />
        ))}
      </g>
      <circle cx={318} cy={44} r={12} fill="var(--accent)" />
    </svg>
  );
}
