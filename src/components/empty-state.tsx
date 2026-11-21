import type { ReactNode } from "react";
import { StrokeField } from "@/components/brand/stroke-field";

export function EmptyState({
  title,
  description,
  action,
  phase,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  phase?: number;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-surface/40 px-6 py-16 text-center">
      <StrokeField className="mb-4" />
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {phase ? (
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-accent-text">
          Arrives in build phase {phase}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
